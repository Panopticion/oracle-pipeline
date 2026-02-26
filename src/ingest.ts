/**
 * Corpus document ingestion — upsert + chunk insert via PostgREST.
 */

import type { Corpus, CorpusContentType } from "./types";
import { chunkCorpus, hashCorpusContent } from "./content-helpers";
import type {
  ExistingDocument,
  IngestOptions,
  IngestResult,
  SupabaseClient,
} from "./types";
import { hasSubstantiveChanges, validateCorpus } from "./validate";
import { CHUNK_BATCH_SIZE } from "./constants";
import { injectWatermark } from "./watermark";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map ISO 639-1 codes to Postgres text search configuration names. */
const LANGUAGE_MAP: Record<string, string> = {
  en: "english",
  de: "german",
  fr: "french",
  es: "spanish",
  it: "italian",
  pt: "portuguese",
  nl: "dutch",
  da: "danish",
  fi: "finnish",
  hu: "hungarian",
  no: "norwegian",
  ro: "romanian",
  ru: "russian",
  sv: "swedish",
  tr: "turkish",
};

function normalizeLanguage(lang: string): string {
  return LANGUAGE_MAP[lang.toLowerCase()] ?? lang;
}

// ─── Supabase queries ─────────────────────────────────────────────────────────

/**
 * Fetch the existing corpus_documents row for change detection.
 */
export async function fetchExistingDocument(
  client: SupabaseClient,
  corpusId: string,
): Promise<ExistingDocument | null> {
  const { data, error } = await client
    .from("corpus_documents")
    .select(
      "id, corpus_id, version, content_hash, tier, content_type, frameworks, industries, segments, source_url, source_publisher, last_verified, title, language",
    )
    .eq("corpus_id", corpusId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed fetching existing document for ${corpusId}: ${error.message}`,
    );
  }

  if (!data) return null;

  return data as unknown as ExistingDocument;
}

// ─── Core ingestion ───────────────────────────────────────────────────────────

/**
 * Ingest a single corpus into Supabase.
 *
 * 1. Validates the corpus format (and fact-check if required)
 * 2. Calls upsert_corpus_document() RPC (idempotent, handles versioning)
 * 3. Batch-inserts chunks with denormalized metadata
 *
 * Chunks are created with embedding_status = "pending" — call
 * embedDocumentChunks() afterward to generate vectors.
 */
export async function ingestCorpus(
  client: SupabaseClient,
  corpus: Corpus,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const {
    dryRun = false,
    requireFactCheck = true,
    organizationId,
    ingestedBy = "corpus-pipeline",
    forceRechunk = false,
    watermark = process.env.WATERMARK_ENABLED !== "false",
    watermarkSecret = process.env.WATERMARK_SECRET,
  } = options;

  // Use pre-fetched existing document if caller already has it (avoids redundant query)
  const existing = options.existing !== undefined
    ? options.existing
    : await fetchExistingDocument(client, corpus.corpus_id);

  // Validate
  const validation = validateCorpus(corpus, {
    requireFactCheck,
    existing,
  });

  if (!validation.valid) {
    return {
      document_id: "",
      corpus_id: corpus.corpus_id,
      action: "blocked",
      chunk_count: 0,
      validation,
    };
  }

  const chunks = chunkCorpus(corpus);
  const contentHash = hashCorpusContent(corpus);

  // Check for substantive changes — if none, report unchanged early
  // Skip this short-circuit when forceRechunk is true (admin rechunk action)
  if (
    !forceRechunk &&
    existing &&
    !hasSubstantiveChanges(corpus, existing, contentHash)
  ) {
    return {
      document_id: existing.id,
      corpus_id: corpus.corpus_id,
      action: "unchanged",
      chunk_count: chunks.length,
      validation,
    };
  }

  if (dryRun) {
    return {
      document_id: existing?.id ?? "(dry-run)",
      corpus_id: corpus.corpus_id,
      action: existing ? "updated" : "inserted",
      chunk_count: chunks.length,
      validation,
    };
  }

  // ── 1. Upsert document via RPC ──────────────────────────────────────────

  const contentType: CorpusContentType = corpus.content_type ?? "prose";
  const language = normalizeLanguage(corpus.language ?? "english");
  const lastVerified = corpus.last_verified ||
    new Date().toISOString().split("T")[0];

  // When forceRechunk is true and content is unchanged, pass NULL content_hash
  // to bypass the RPC's hash-equality short-circuit. The RPC checks:
  //   IF v_existing_hash IS NOT NULL AND p_content_hash IS NOT NULL AND ...
  // Passing NULL makes p_content_hash IS NOT NULL → false, falling through
  // to the update path (which deletes old chunks so we can re-insert).
  // We restore the real hash afterward via a direct update.
  const bypassHash = forceRechunk && existing?.content_hash === contentHash;

  const rpcParams: Record<string, unknown> = {
    p_corpus_id: corpus.corpus_id,
    p_version: corpus.version,
    p_title: corpus.title,
    p_tier: corpus.tier,
    p_content_type: contentType,
    p_frameworks: corpus.frameworks,
    p_industries: corpus.industries,
    p_segments: corpus.segments,
    p_source_url: corpus.source_url,
    p_source_publisher: corpus.source_publisher,
    p_last_verified: lastVerified,
    p_content_hash: bypassHash ? null : contentHash,
    p_ingested_by: ingestedBy,
    p_language: language,
    p_sire_subject: corpus.sire?.subject ?? null,
    p_sire_included: corpus.sire?.included ?? [],
    p_sire_excluded: corpus.sire?.excluded ?? [],
    p_sire_relevant: corpus.sire?.relevant ?? [],
  };

  if (organizationId) {
    rpcParams.p_organization_id = organizationId;
  }

  const { data: rpcData, error: rpcError } = await client.rpc(
    "upsert_corpus_document",
    rpcParams,
  );

  if (rpcError) {
    throw new Error(
      `upsert_corpus_document failed for ${corpus.corpus_id}: ${rpcError.message}`,
    );
  }

  // RPC returns a single row or array with one row
  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | Record<string, unknown>
    | undefined;
  if (
    !row ||
    typeof row.document_id !== "string" ||
    typeof row.action !== "string"
  ) {
    throw new Error(
      `upsert_corpus_document returned unexpected payload for ${corpus.corpus_id}`,
    );
  }

  const documentId = row.document_id;
  const action = row.action as "inserted" | "updated" | "unchanged";

  // Skip chunk insert if content unchanged (RPC-level detection)
  if (action === "unchanged") {
    return {
      document_id: documentId,
      corpus_id: corpus.corpus_id,
      action,
      chunk_count: chunks.length,
      validation,
    };
  }

  // ── 2. Insert chunks in batches ─────────────────────────────────────────

  if (watermark) {
    console.error(
      `[corpus-pipeline] Watermarking ${
        String(chunks.length)
      } chunks for ${corpus.corpus_id}${watermarkSecret ? " (HMAC)" : ""}`,
    );
  }

  const chunkRows = chunks.map((c) => ({
    document_id: documentId,
    sequence: c.sequence,
    section_title: c.section_title,
    heading_level: c.heading_level,
    content: watermark
      ? injectWatermark(c.content, {
        corpusId: corpus.corpus_id,
        sequence: c.sequence,
        contentHash: c.content_hash,
        secret: watermarkSecret,
      })
      : c.content,
    content_hash: c.content_hash,
    token_count: c.token_count,
    heading_path: c.heading_path,
    // Denormalized from document
    corpus_id: corpus.corpus_id,
    tier: corpus.tier,
    content_type: contentType,
    language,
    frameworks: corpus.frameworks,
    industries: corpus.industries,
    segments: corpus.segments,
    // S.I.R.E. identity-first retrieval metadata (denormalized)
    sire_subject: corpus.sire?.subject ?? null,
    sire_included: corpus.sire?.included ?? [],
    sire_excluded: corpus.sire?.excluded ?? [],
    sire_relevant: corpus.sire?.relevant ?? [],
    // Embedding status — pending until embed step
    embedding_status: "pending",
  }));

  for (let i = 0; i < chunkRows.length; i += CHUNK_BATCH_SIZE) {
    const batch = chunkRows.slice(i, i + CHUNK_BATCH_SIZE);
    // Upsert on (document_id, sequence) for crash-recovery idempotency:
    // if a previous run partially inserted chunks and then crashed, re-running
    // updates existing rows instead of failing with a duplicate key error.
    const { error: insertError } = await client
      .from("corpus_chunks")
      .upsert(batch, { onConflict: "document_id,sequence" });

    if (insertError) {
      throw new Error(
        `Chunk upsert batch at offset ${
          String(i)
        } for ${corpus.corpus_id}: ${insertError.message}`,
      );
    }
  }

  // ── 3. Post-insert bookkeeping ───────────────────────────────────────────

  // Update chunk_count on the document (RPC sets it to 0 on update)
  // and restore content_hash if we bypassed it for forceRechunk.
  const docUpdate: Record<string, unknown> = {
    chunk_count: chunkRows.length,
  };
  if (bypassHash) {
    docUpdate.content_hash = contentHash;
  }

  const { error: countError } = await client
    .from("corpus_documents")
    .update(docUpdate)
    .eq("id", documentId);

  if (countError) {
    // Non-fatal: chunks are inserted, just metadata is slightly off
    console.error(
      `[corpus-pipeline] Failed updating document metadata for ${corpus.corpus_id}: ${countError.message}`,
    );
  }

  return {
    document_id: documentId,
    corpus_id: corpus.corpus_id,
    action,
    chunk_count: chunks.length,
    validation,
  };
}
