/**
 * Session management — multi-document parse batches with crosswalk generation.
 *
 * Sessions group multiple document uploads. Each document is AI-parsed and
 * reviewed individually, then a crosswalk is generated across all documents.
 * The final bundle (documents + crosswalk) can be downloaded.
 */

import { createHash } from "node:crypto";
import type {
  CorpusChunkRaw,
  CorpusSession,
  CreateSessionOptions,
  CrosswalkResult,
  GenerateCrosswalkOptions,
  SessionQualitySnapshotPayload,
  SessionDocument,
  SessionParseOptions,
  SessionParseResult,
  SupabaseClient,
} from "./types";
import { callOpenRouter } from "./openrouter";
import {
  buildParseSystemPrompt,
  buildParseUserMessage,
} from "./prompts/parse-document";
import {
  buildCrosswalkSystemPrompt,
  buildCrosswalkUserMessage,
} from "./prompts/crosswalk-document";
import type { CrosswalkDocumentInput } from "./prompts/crosswalk-document";
import {
  chunkCorpus,
  chunkCrosswalkMarkdown,
  parseCorpusContent,
} from "./content-helpers";
import { injectWatermark } from "./watermark";
import { PARSE_MODEL_DEFAULT } from "./constants";

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function resolveSourceFilename(sourceFileName: string | undefined, sourceHash: string): string {
  const trimmed = sourceFileName?.trim();
  if (trimmed) return trimmed;
  return `upload-${sourceHash.slice(0, 8)}.txt`;
}

function extractMarkdown(raw: string): string {
  // Match opening ```markdown fence and extract everything up to the LAST ``` fence.
  // Greedy ([\s\S]*) ensures we don't stop at embedded code blocks in the body.
  const fenceMatch = raw.match(/```(?:markdown)?\s*\n([\s\S]*)\n\s*```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return raw.trim();
}

function extractMarkdownCandidates(raw: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: string | null | undefined) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  // 1) Existing strict extraction (single trailing fenced block or raw text).
  push(extractMarkdown(raw));

  // 2) Capture all fenced blocks anywhere in output (markdown/yaml/plain).
  const blockRegex = /```(?:markdown|md|yaml|yml)?\s*\n([\s\S]*?)\n\s*```/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(raw)) !== null) {
    push(match[1]);
  }

  // 3) If frontmatter appears mid-response, try slicing from first delimiter.
  const fmIndex = raw.search(/(^|\n)---\s*\n/);
  if (fmIndex >= 0) {
    const start = raw[fmIndex] === "-" ? fmIndex : fmIndex + 1;
    push(raw.slice(start));
  }

  // 4) Last resort: full raw trimmed response.
  push(raw);

  return candidates;
}

function selectValidCorpusMarkdown(raw: string): {
  markdown: string | null;
  parseError: string | null;
  fallback: string;
} {
  const candidates = extractMarkdownCandidates(raw);
  const fallback = candidates[0] ?? raw.trim();
  let lastError: string | null = null;

  for (const candidate of candidates) {
    try {
      parseCorpusContent(candidate);
      return { markdown: candidate, parseError: null, fallback };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    markdown: null,
    parseError: lastError ?? "Unknown parse validation error",
    fallback,
  };
}

// ─── Session CRUD ───────────────────────────────────────────────────────────

/**
 * Create a new parse session.
 */
export async function createSession(
  client: SupabaseClient,
  options: CreateSessionOptions = {},
): Promise<CorpusSession> {
  const { data, error } = await client
    .from("corpus_parse_sessions")
    .insert({
      name: options.name ?? "Untitled Session",
      organization_id: options.organizationId ?? null,
      created_by: options.userId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return data as CorpusSession;
}

/**
 * Get a session by ID.
 */
export async function getSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<CorpusSession> {
  const { data, error } = await client
    .from("corpus_parse_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return data as CorpusSession;
}

/**
 * List all sessions for an organization.
 */
export async function listSessions(
  client: SupabaseClient,
  organizationId?: string,
): Promise<CorpusSession[]> {
  let query = client
    .from("corpus_parse_sessions")
    .select("*")
    .order("created_at", { ascending: false });

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list sessions: ${error.message}`);
  }

  return (data ?? []) as CorpusSession[];
}

/**
 * Update session name.
 */
export async function updateSessionName(
  client: SupabaseClient,
  sessionId: string,
  name: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ name })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to update session name: ${error.message}`);
  }
}

/**
 * Set a session's public visibility.
 */
export async function setSessionPublic(
  client: SupabaseClient,
  sessionId: string,
  isPublic: boolean,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ is_public: isPublic })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to update session visibility: ${error.message}`);
  }
}

/**
 * Delete a session (cascades to all documents).
 */
export async function deleteSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to delete session: ${error.message}`);
  }
}

// ─── Session Documents ──────────────────────────────────────────────────────

/**
 * Get all documents in a session.
 */
export async function getSessionDocuments(
  client: SupabaseClient,
  sessionId: string,
): Promise<SessionDocument[]> {
  const { data, error } = await client
    .from("corpus_session_documents")
    .select("*")
    .eq("session_id", sessionId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to get session documents: ${error.message}`);
  }

  return (data ?? []) as SessionDocument[];
}

/**
 * Insert a document row for parsing (no AI call yet).
 *
 * Returns the new document ID immediately so the client can show a
 * "parsing" card. Follow up with reparseDocument() to trigger the
 * actual AI parse.
 */
export async function insertDocumentForParse(
  client: SupabaseClient,
  sessionId: string,
  sourceText: string,
  options: {
    sourceFileName?: string;
    userId?: string;
    organizationId?: string;
    model?: string;
  },
): Promise<{
  documentId: string;
  sourceHash: string;
  sortOrder: number;
  isDuplicate: boolean;
}> {
  const model = options.model ?? PARSE_MODEL_DEFAULT;
  const sourceHash = sha256(sourceText);
  const sourceFilename = resolveSourceFilename(options.sourceFileName, sourceHash);

  const { count } = await client
    .from("corpus_session_documents")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId);

  const { data, error: insertError } = await client
    .from("corpus_session_documents")
    .insert({
      session_id: sessionId,
      source_filename: sourceFilename,
      source_text: sourceText,
      source_hash: sourceHash,
      status: "parsing",
      parse_model: model,
      organization_id: options.organizationId ?? null,
      created_by: options.userId ?? null,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: existing, error: existingError } = await client
        .from("corpus_session_documents")
        .select("id, sort_order")
        .eq("session_id", sessionId)
        .eq("source_hash", sourceHash)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError || !existing) {
        throw new Error(
          `Document already uploaded to this session (duplicate source hash: ${sourceHash.slice(0, 12)}...)`,
        );
      }

      return {
        documentId: existing.id as string,
        sourceHash,
        sortOrder: (existing.sort_order as number) ?? 0,
        isDuplicate: true,
      };
    }
    throw new Error(`Failed to add document: ${insertError.message}`);
  }

  return {
    documentId: data.id as string,
    sourceHash,
    sortOrder: count ?? 0,
    isDuplicate: false,
  };
}

/**
 * Add a document to a session and parse it with AI.
 *
 * 1. Inserts a document row with status 'parsing'
 * 2. Calls OpenRouter with the CFPO parse prompt
 * 3. Updates the document with the parsed result
 */
export async function addAndParseDocument(
  client: SupabaseClient,
  sessionId: string,
  sourceText: string,
  options: SessionParseOptions,
): Promise<SessionParseResult> {
  const model = options.model ?? PARSE_MODEL_DEFAULT;
  const sourceHash = sha256(sourceText);
  const sourceFilename = resolveSourceFilename(options.sourceFileName, sourceHash);

  // Get current document count for sort order
  const { count } = await client
    .from("corpus_session_documents")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId);

  // Insert document row
  const { data, error: insertError } = await client
    .from("corpus_session_documents")
    .insert({
      session_id: sessionId,
      source_filename: sourceFilename,
      source_text: sourceText,
      source_hash: sourceHash,
      status: "parsing",
      parse_model: model,
      organization_id: options.organizationId ?? null,
      created_by: options.userId ?? null,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      throw new Error(
        `Document already uploaded to this session (duplicate source hash: ${sourceHash.slice(0, 12)}...)`,
      );
    }
    throw new Error(`Failed to add document: ${insertError.message}`);
  }

  const documentId = data.id as string;

  // Call OpenRouter for AI parsing
  try {
    const systemPrompt = buildParseSystemPrompt(model, options.hints);
    const userMessage = buildParseUserMessage(
      sourceText,
      options.sourceFileName,
    );

    const result = await callOpenRouter(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        apiKey: options.openrouterApiKey,
        model,
      },
    );

    const selected = selectValidCorpusMarkdown(result.content);
    if (!selected.markdown) {
      const msg = selected.parseError ?? "Unknown parse validation error";

      await client
        .from("corpus_session_documents")
        .update({
          status: "failed",
          error_message: `AI output failed validation: ${msg}`,
          parsed_markdown: selected.fallback,
          parse_tokens_in: result.inputTokens,
          parse_tokens_out: result.outputTokens,
        })
        .eq("id", documentId);

      throw new Error(
        `AI produced invalid corpus Markdown: ${msg}\n\nRaw output saved to document ${documentId} for inspection.`,
      );
    }

    const parsedMarkdown = selected.markdown;

    // Update document with parsed result
    await client
      .from("corpus_session_documents")
      .update({
        parsed_markdown: parsedMarkdown,
        parse_tokens_in: result.inputTokens,
        parse_tokens_out: result.outputTokens,
        status: "parsed",
      })
      .eq("id", documentId);

    return {
      documentId,
      parsedMarkdown,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } catch (err) {
    // Mark document as failed
    const msg = err instanceof Error ? err.message : String(err);
    await client
      .from("corpus_session_documents")
      .update({
        status: "failed",
        error_message: `Parse failed: ${msg}`,
      })
      .eq("id", documentId);

    throw err;
  }
}

/**
 * Re-parse a document that failed or needs re-parsing.
 */
export async function reparseDocument(
  client: SupabaseClient,
  documentId: string,
  options: SessionParseOptions,
): Promise<SessionParseResult> {
  // Fetch existing document
  const { data: doc, error } = await client
    .from("corpus_session_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const model = options.model ?? PARSE_MODEL_DEFAULT;

  // Update status to parsing
  await client
    .from("corpus_session_documents")
    .update({ status: "parsing", error_message: null, parse_model: model })
    .eq("id", documentId);

  // Call OpenRouter
  try {
    const systemPrompt = buildParseSystemPrompt(model, options.hints);
    const userMessage = buildParseUserMessage(
      doc.source_text as string,
      (doc.source_filename as string) ?? options.sourceFileName,
    );

    const result = await callOpenRouter(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        apiKey: options.openrouterApiKey,
        model,
      },
    );

    const selected = selectValidCorpusMarkdown(result.content);
    if (!selected.markdown) {
      const msg = selected.parseError ?? "Unknown parse validation error";

      await client
        .from("corpus_session_documents")
        .update({
          status: "failed",
          error_message: `AI output failed validation: ${msg}`,
          parsed_markdown: selected.fallback,
          parse_tokens_in: result.inputTokens,
          parse_tokens_out: result.outputTokens,
        })
        .eq("id", documentId);

      throw new Error(`AI produced invalid corpus Markdown: ${msg}`);
    }

    const parsedMarkdown = selected.markdown;

    // Update with result
    await client
      .from("corpus_session_documents")
      .update({
        parsed_markdown: parsedMarkdown,
        parse_tokens_in: result.inputTokens,
        parse_tokens_out: result.outputTokens,
        status: "parsed",
        user_markdown: null, // Clear previous edits
      })
      .eq("id", documentId);

    return {
      documentId,
      parsedMarkdown,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await client
      .from("corpus_session_documents")
      .update({
        status: "failed",
        error_message: `Re-parse failed: ${msg}`,
      })
      .eq("id", documentId);

    throw err;
  }
}

/**
 * Save user edits to a document's parsed markdown.
 */
export async function saveDocumentEdit(
  client: SupabaseClient,
  documentId: string,
  userMarkdown: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_session_documents")
    .update({
      user_markdown: userMarkdown,
      status: "edited",
    })
    .eq("id", documentId);

  if (error) {
    throw new Error(`Failed to save edit: ${error.message}`);
  }
}

/**
 * Delete a document from a session.
 */
export async function deleteDocument(
  client: SupabaseClient,
  documentId: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_session_documents")
    .delete()
    .eq("id", documentId);

  if (error) {
    throw new Error(`Failed to delete document: ${error.message}`);
  }
}

// ─── Chunk & Watermark ──────────────────────────────────────────────────────

/**
 * Chunk a parsed/edited document into semantic sections.
 *
 * Reads user_markdown (if edited) or parsed_markdown, parses frontmatter,
 * runs chunkCorpus() to split on H2/H3 boundaries, and stores the result
 * in chunks_json. Sets status to 'chunked'.
 */
export async function chunkDocument(
  client: SupabaseClient,
  documentId: string,
): Promise<{ documentId: string; chunkCount: number; chunks: CorpusChunkRaw[] }> {
  const { data: doc, error } = await client
    .from("corpus_session_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const markdown = (doc.user_markdown ?? doc.parsed_markdown ?? "") as string;
  if (!markdown.trim()) {
    throw new Error("Document has no parsed content to chunk");
  }

  // Parse frontmatter + body into a Corpus object
  const corpus = parseCorpusContent(markdown);
  const chunks = chunkCorpus(corpus);

  // Store chunks and update status
  const { error: updateError } = await client
    .from("corpus_session_documents")
    .update({
      chunks_json: chunks,
      status: "chunked",
    })
    .eq("id", documentId);

  if (updateError) {
    throw new Error(`Failed to save chunks: ${updateError.message}`);
  }

  return { documentId, chunkCount: chunks.length, chunks };
}

/**
 * Watermark all chunks in a chunked document.
 *
 * Reads chunks_json, extracts the corpus_id from the document's markdown
 * frontmatter, and injects a provenance watermark into each chunk's content.
 * Updates chunks_json in-place and sets status to 'watermarked'.
 */
export async function watermarkDocument(
  client: SupabaseClient,
  documentId: string,
): Promise<{ documentId: string; chunkCount: number; chunks: CorpusChunkRaw[] }> {
  const { data: doc, error } = await client
    .from("corpus_session_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const chunks = doc.chunks_json as CorpusChunkRaw[] | null;
  if (!chunks || chunks.length === 0) {
    throw new Error("Document has no chunks — run chunkDocument first");
  }

  // Extract corpus_id from frontmatter
  const markdown = (doc.user_markdown ?? doc.parsed_markdown ?? "") as string;
  const corpus = parseCorpusContent(markdown);
  const corpusId = corpus.corpus_id;

  // Watermark each chunk
  const watermarkedChunks: CorpusChunkRaw[] = chunks.map((chunk) => ({
    ...chunk,
    content: injectWatermark(chunk.content, {
      corpusId,
      sequence: chunk.sequence,
      contentHash: chunk.content_hash,
    }),
  }));

  // Update chunks and status
  const { error: updateError } = await client
    .from("corpus_session_documents")
    .update({
      chunks_json: watermarkedChunks,
      status: "watermarked",
    })
    .eq("id", documentId);

  if (updateError) {
    throw new Error(`Failed to save watermarked chunks: ${updateError.message}`);
  }

  return { documentId, chunkCount: watermarkedChunks.length, chunks: watermarkedChunks };
}

// ─── Session Status ─────────────────────────────────────────────────────────

/**
 * Mark a session as complete (all documents parsed/edited, ready for crosswalk).
 */
export async function markSessionComplete(
  client: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ status: "complete" })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to mark session complete: ${error.message}`);
  }
}

/**
 * Archive a session.
 */
export async function archiveSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ status: "archived" })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to archive session: ${error.message}`);
  }
}

// ─── Quality Snapshots ───────────────────────────────────────────────────────

export async function recordSessionQualitySnapshot(
  client: SupabaseClient,
  sessionId: string,
  metrics: SessionQualitySnapshotPayload,
  userId?: string,
): Promise<{ inserted: boolean }> {
  const { data: session, error: sessionErr } = await client
    .from("corpus_parse_sessions")
    .select("id, organization_id, created_by")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const metricsJson = JSON.stringify(metrics);
  const metricsHash = sha256(metricsJson);

  const { data: latest, error: latestErr } = await client
    .from("corpus_session_quality_snapshots")
    .select("metrics_hash")
    .eq("session_id", sessionId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    throw new Error(`Failed to read latest quality snapshot: ${latestErr.message}`);
  }

  if (latest?.metrics_hash === metricsHash) {
    return { inserted: false };
  }

  const { error: insertErr } = await client
    .from("corpus_session_quality_snapshots")
    .insert({
      session_id: sessionId,
      organization_id: (session.organization_id as string | null) ?? null,
      created_by: userId ?? (session.created_by as string | null) ?? null,
      metrics_json: metrics,
      metrics_hash: metricsHash,
    });

  if (insertErr) {
    throw new Error(`Failed to insert quality snapshot: ${insertErr.message}`);
  }

  return { inserted: true };
}

// ─── Crosswalk Generation ───────────────────────────────────────────────────

/**
 * Generate a crosswalk mapping across all documents in a session.
 *
 * 1. Fetches all parsed/edited documents
 * 2. Extracts frontmatter metadata from each
 * 3. Calls OpenRouter with the crosswalk CFPO prompt
 * 4. Stores the result on the session
 */
export async function generateCrosswalk(
  client: SupabaseClient,
  sessionId: string,
  options: GenerateCrosswalkOptions,
): Promise<CrosswalkResult> {
  const model = options.model ?? PARSE_MODEL_DEFAULT;

  // Update session status
  await client
    .from("corpus_parse_sessions")
    .update({ status: "crosswalk_pending" })
    .eq("id", sessionId);

  // Fetch all documents
  const docs = await getSessionDocuments(client, sessionId);

  // Crosswalk is an expensive operation. Require quality gates:
  // 1) document must be watermarked
  // 2) document must be promoted to Encyclopedia
  const promotedWatermarkedDocs = docs.filter(
    (d) => d.status === "watermarked" && Boolean(d.promoted_at),
  );

  if (promotedWatermarkedDocs.length < 2) {
    await client
      .from("corpus_parse_sessions")
      .update({ status: "complete" })
      .eq("id", sessionId);

    const watermarkedCount = docs.filter((d) => d.status === "watermarked").length;
    const promotedCount = docs.filter((d) => Boolean(d.promoted_at)).length;

    throw new Error(
      `Need at least 2 promoted + watermarked documents to generate a crosswalk (watermarked=${String(watermarkedCount)}, promoted=${String(promotedCount)}, promoted_and_watermarked=${String(promotedWatermarkedDocs.length)}).`,
    );
  }

  // Build crosswalk inputs from promoted + watermarked documents only
  const crosswalkInputs: CrosswalkDocumentInput[] = promotedWatermarkedDocs.map((doc) => {
    const markdown = doc.user_markdown ?? doc.parsed_markdown ?? "";

    // Extract metadata from frontmatter
    let corpusId = "unknown";
    let title = doc.source_filename;
    let tier = "tier_3";
    let frameworks: string[] = [];

    try {
      const corpus = parseCorpusContent(markdown);
      corpusId = corpus.corpus_id;
      title = corpus.title;
      tier = corpus.tier;
      frameworks = corpus.frameworks;
    } catch {
      // Use defaults if parsing fails
    }

    return { corpusId, title, tier, frameworks, markdown };
  });

  // Call OpenRouter
  try {
    const systemPrompt = buildCrosswalkSystemPrompt(model);
    const userMessage = buildCrosswalkUserMessage(crosswalkInputs);

    const result = await callOpenRouter(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        apiKey: options.openrouterApiKey,
        model,
      },
    );

    const crosswalkMarkdown = extractMarkdown(result.content);

    // Chunk and watermark the crosswalk
    const crosswalkCorpusId = `crosswalk-v1-${sessionId}`;
    const rawChunks = chunkCrosswalkMarkdown(crosswalkCorpusId, crosswalkMarkdown);
    const crosswalkChunks: CorpusChunkRaw[] = rawChunks.map((chunk) => ({
      ...chunk,
      content: injectWatermark(chunk.content, {
        corpusId: crosswalkCorpusId,
        sequence: chunk.sequence,
        contentHash: chunk.content_hash,
      }),
    }));

    // Store result on session
    await client
      .from("corpus_parse_sessions")
      .update({
        status: "crosswalk_done",
        crosswalk_markdown: crosswalkMarkdown,
        crosswalk_chunks_json: crosswalkChunks,
        crosswalk_model: model,
        crosswalk_tokens_in: result.inputTokens,
        crosswalk_tokens_out: result.outputTokens,
      })
      .eq("id", sessionId);

    return {
      crosswalkMarkdown,
      crosswalkChunks,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } catch (err) {
    // Revert session status
    await client
      .from("corpus_parse_sessions")
      .update({ status: "complete" })
      .eq("id", sessionId);

    throw err;
  }
}

/**
 * Save user edits to a session's crosswalk markdown.
 */
export async function saveCrosswalkEdit(
  client: SupabaseClient,
  sessionId: string,
  crosswalkMarkdown: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ crosswalk_markdown: crosswalkMarkdown })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to save crosswalk edit: ${error.message}`);
  }
}
