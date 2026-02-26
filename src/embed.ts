/**
 * Corpus embedding generation — OpenAI vectors for corpus chunks.
 *
 * Uses the VPC sovereignty pipeline functions:
 *   - start_pipeline_run()         → register attestation (sovereignty gate)
 *   - claim_corpus_chunks_for_embedding() → lease chunks (FOR UPDATE SKIP LOCKED)
 *   - complete_corpus_chunk_embedding()   → write vector + event log
 *   - fail_corpus_chunk_embedding()       → mark failure + event log
 *
 * Un-attributed embeddings are structurally impossible (CHECK constraint).
 *
 * Hardened:
 *   - Exponential backoff + retry on transient OpenAI failures (429, 5xx)
 *   - Lease-based claiming prevents double-embed across concurrent workers
 *   - Every embedding operation is logged to corpus_embedding_events
 */

import type {
  EmbedOptions,
  EmbedResult,
  PendingChunk,
  SovereigntyContext,
  SupabaseClient,
} from "./types";
import {
  CLAIM_BATCH_SIZE,
  EMBED_BATCH_SIZE,
  EMBED_MAX_RETRIES,
  EMBED_RETRY_BASE_MS,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  LEASE_SECONDS,
  TRANSIENT_STATUS_CODES,
} from "./constants";

// ─── Retry helpers (modeled on openrouter.ts) ────────────────────────────────

function isTransient(status: number): boolean {
  return TRANSIENT_STATUS_CODES.includes(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(message: string): boolean {
  return (
    message.includes("fetch failed") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("UND_ERR_SOCKET")
  );
}

// ─── OpenAI embedding ─────────────────────────────────────────────────────────

/**
 * Embed a batch of text strings via OpenAI text-embedding-3-large (512d Matryoshka).
 *
 * Retries on transient failures (429 rate-limit, 5xx server errors) with
 * exponential backoff: 1s, 2s, 4s. Non-transient errors (400, 401) throw immediately.
 */
async function embedBatch(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      // Retry on transient HTTP errors (429, 5xx)
      if (isTransient(res.status) && attempt < EMBED_MAX_RETRIES) {
        const backoff = EMBED_RETRY_BASE_MS * 2 ** attempt;
        console.warn(
          `[corpus-pipeline] OpenAI HTTP ${String(res.status)} (attempt ${
            String(attempt + 1)
          }/${String(EMBED_MAX_RETRIES + 1)}) — retrying in ${
            String(backoff)
          }ms`,
        );
        lastError = new Error(
          `OpenAI embeddings HTTP ${String(res.status)} (transient)`,
        );
        await sleep(backoff);
        continue;
      }

      const body = (await res.json()) as {
        data?: Array<{ embedding: number[] }>;
        error?: { message?: string };
      };

      if (!res.ok || !body.data) {
        const msg = body.error?.message ??
          `${String(res.status)} ${res.statusText}`;
        throw new Error(`OpenAI embeddings failed: ${msg}`);
      }

      return body.data.map((d) => d.embedding);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= EMBED_MAX_RETRIES) {
        throw lastError;
      }

      // Retry on transient network errors
      if (isRetryableNetworkError(lastError.message)) {
        const backoff = EMBED_RETRY_BASE_MS * 2 ** attempt;
        console.warn(
          `[corpus-pipeline] Network error (attempt ${String(attempt + 1)}/${
            String(EMBED_MAX_RETRIES + 1)
          }): ${lastError.message} — retrying in ${String(backoff)}ms`,
        );
        await sleep(backoff);
        continue;
      }

      // Non-transient error: don't retry
      throw lastError;
    }
  }

  throw lastError ?? new Error("embedBatch failed");
}

/** Convert a numeric vector to PostgREST pgvector literal format */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/** Prepare chunk text for embedding */
function chunkTextForEmbedding(chunk: PendingChunk): string {
  return `${chunk.section_title}\n\n${chunk.content}`.trim();
}

// ─── Sovereignty RPC wrappers ────────────────────────────────────────────────

/**
 * Register a pipeline run attestation (sovereignty gate).
 *
 * Must be called once per run before any claim/complete/fail operations.
 * Idempotent by run_id if all bindings match.
 */
export async function registerPipelineRun(
  client: SupabaseClient,
  sovereignty: SovereigntyContext,
): Promise<string> {
  const { data, error } = await client.rpc("start_pipeline_run", {
    p_run_id: sovereignty.runId,
    p_triggered_by: sovereignty.triggeredBy,
    p_user_id: sovereignty.userId ?? null,
    p_organization_id: sovereignty.organizationId ?? null,
    p_embedding_authority_id: sovereignty.embeddingAuthorityId,
    p_egress_policy_id: sovereignty.egressPolicyId,
  });

  if (error) {
    throw new Error(`start_pipeline_run failed: ${error.message}`);
  }

  return data as string;
}

/**
 * Claim a batch of chunks for embedding via RPC.
 * Uses FOR UPDATE SKIP LOCKED — safe for concurrent workers.
 */
async function claimChunks(
  client: SupabaseClient,
  sovereignty: SovereigntyContext,
  filterCorpusIds?: string[],
): Promise<PendingChunk[]> {
  const { data, error } = await client.rpc(
    "claim_corpus_chunks_for_embedding",
    {
      p_run_id: sovereignty.runId,
      p_embedding_authority_id: sovereignty.embeddingAuthorityId,
      p_batch_size: CLAIM_BATCH_SIZE,
      p_lease_seconds: LEASE_SECONDS,
      p_filter_corpus_ids: filterCorpusIds ?? null,
      p_filter_org_id: sovereignty.organizationId ?? null,
    },
  );

  if (error) {
    throw new Error(
      `claim_corpus_chunks_for_embedding failed: ${error.message}`,
    );
  }

  return (data ?? []) as PendingChunk[];
}

/**
 * Complete embedding for a single chunk via RPC.
 * Writes the vector and logs to corpus_embedding_events.
 */
async function completeChunkEmbedding(
  client: SupabaseClient,
  sovereignty: SovereigntyContext,
  chunkId: string,
  vector: number[],
): Promise<boolean> {
  const modelVersion = `${EMBEDDING_MODEL}:${String(EMBEDDING_DIMENSIONS)}d`;

  const { data, error } = await client.rpc(
    "complete_corpus_chunk_embedding",
    {
      p_chunk_id: chunkId,
      p_run_id: sovereignty.runId,
      p_embedding_authority_id: sovereignty.embeddingAuthorityId,
      p_embedding: toVectorLiteral(vector),
      p_embedding_model: EMBEDDING_MODEL,
      p_embedding_model_version: modelVersion,
    },
  );

  if (error) {
    console.error(
      `[corpus-pipeline] complete_corpus_chunk_embedding failed for ${chunkId}: ${error.message}`,
    );
    return false;
  }

  return data as boolean;
}

/**
 * Mark a chunk as failed via RPC.
 * Logs the failure to corpus_embedding_events.
 */
async function failChunkEmbedding(
  client: SupabaseClient,
  sovereignty: SovereigntyContext,
  chunkId: string,
  errorMessage: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("fail_corpus_chunk_embedding", {
    p_chunk_id: chunkId,
    p_run_id: sovereignty.runId,
    p_embedding_authority_id: sovereignty.embeddingAuthorityId,
    p_error: errorMessage,
  });

  if (error) {
    console.error(
      `[corpus-pipeline] fail_corpus_chunk_embedding failed for ${chunkId}: ${error.message}`,
    );
    return false;
  }

  return data as boolean;
}

// ─── Core embedding loop ─────────────────────────────────────────────────────

/**
 * Process a batch of claimed chunks: embed via OpenAI, then complete/fail each.
 */
async function processClaimedChunks(
  client: SupabaseClient,
  sovereignty: SovereigntyContext,
  chunks: PendingChunk[],
  apiKey: string,
): Promise<{ embedded: number; failed: number }> {
  let embedded = 0;
  let failed = 0;

  // Sub-batch for OpenAI (EMBED_BATCH_SIZE may be smaller than CLAIM_BATCH_SIZE)
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map(chunkTextForEmbedding);

    let vectors: number[][];
    try {
      vectors = await embedBatch(texts, apiKey);
    } catch (err) {
      // OpenAI failed after all retries — fail the entire sub-batch
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[corpus-pipeline] Embedding batch failed after retries: ${errorMsg}`,
      );
      for (const chunk of batch) {
        await failChunkEmbedding(client, sovereignty, chunk.chunk_id, errorMsg);
        failed++;
      }
      continue;
    }

    // Write each vector individually via complete RPC
    for (const [idx, chunk] of batch.entries()) {
      const vector = vectors.at(idx);
      if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
        console.warn(
          `[corpus-pipeline] Invalid vector for chunk ${chunk.chunk_id} — marking failed`,
        );
        await failChunkEmbedding(
          client,
          sovereignty,
          chunk.chunk_id,
          `Invalid vector: expected ${String(EMBEDDING_DIMENSIONS)} dims, got ${
            String(vector?.length ?? 0)
          }`,
        );
        failed++;
        continue;
      }

      const ok = await completeChunkEmbedding(
        client,
        sovereignty,
        chunk.chunk_id,
        vector,
      );

      if (ok) {
        embedded++;
      } else {
        // Stale lease or run_id mismatch — another worker won
        console.warn(
          `[corpus-pipeline] complete_corpus_chunk_embedding returned false for ${chunk.chunk_id} — lease lost`,
        );
        failed++;
      }
    }
  }

  return { embedded, failed };
}

// ─── Per-document embedding ───────────────────────────────────────────────────

/**
 * Generate embeddings for all pending chunks belonging to a document.
 *
 * Uses claim → embed → complete/fail sovereign flow.
 * Timeout-aware: stops after maxWaitMs, leaving remaining chunks for
 * the backfill script.
 */
export async function embedDocumentChunks(
  client: SupabaseClient,
  documentId: string,
  options: EmbedOptions,
): Promise<EmbedResult> {
  const { openaiApiKey, sovereignty, maxWaitMs, dryRun = false } = options;
  const startTime = Date.now();
  let embedded = 0;
  let failedCount = 0;

  // Get the corpus_id for this document so we can filter claims
  const { data: doc, error: docError } = await client
    .from("corpus_documents")
    .select("corpus_id")
    .eq("id", documentId)
    .single();

  if (docError || !doc) {
    throw new Error(
      `Failed fetching document ${documentId}: ${
        docError?.message ?? "not found"
      }`,
    );
  }

  const corpusId = (doc as { corpus_id: string }).corpus_id;

  if (dryRun) {
    // Count pending chunks without claiming
    const { count } = await client
      .from("corpus_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId)
      .in("embedding_status", ["pending", "stale"]);

    return { embedded: 0, pending: count ?? 0 };
  }

  // Claim-and-process loop (filtered to this document's corpus_id)
  while (true) {
    if (maxWaitMs && Date.now() - startTime > maxWaitMs) {
      break;
    }

    const claimed = await claimChunks(client, sovereignty, [corpusId]);
    if (claimed.length === 0) break;

    // Filter to only chunks for this specific document
    const docChunks = claimed.filter((c) => c.document_id === documentId);
    if (docChunks.length === 0) break;

    const result = await processClaimedChunks(
      client,
      sovereignty,
      docChunks,
      openaiApiKey,
    );
    embedded += result.embedded;
    failedCount += result.failed;
  }

  return {
    embedded,
    pending: 0,
    ...(failedCount > 0 ? { failed: failedCount } : {}),
  };
}

// ─── Bulk embedding (backfill) ────────────────────────────────────────────────

/**
 * Embed all pending/stale chunks across the entire corpus corpus.
 *
 * Uses claim → embed → complete/fail sovereign flow.
 * Claims chunks in batches until none remain or timeout/limit is reached.
 */
export async function embedPendingChunks(
  client: SupabaseClient,
  options: EmbedOptions & { limit?: number },
): Promise<EmbedResult> {
  const { openaiApiKey, sovereignty, maxWaitMs, dryRun = false, limit } =
    options;
  const startTime = Date.now();
  const maxItems = limit ?? Number.POSITIVE_INFINITY;

  let embedded = 0;
  let processed = 0;
  let failedCount = 0;

  if (dryRun) {
    const { count } = await client
      .from("corpus_chunks")
      .select("id", { count: "exact", head: true })
      .in("embedding_status", ["pending", "stale"]);

    return { embedded: 0, pending: count ?? 0 };
  }

  // Claim-and-process loop
  while (processed < maxItems) {
    if (maxWaitMs && Date.now() - startTime > maxWaitMs) {
      break;
    }

    const claimed = await claimChunks(client, sovereignty);
    if (claimed.length === 0) break;

    const result = await processClaimedChunks(
      client,
      sovereignty,
      claimed,
      openaiApiKey,
    );
    embedded += result.embedded;
    failedCount += result.failed;
    processed += claimed.length;
  }

  // Count remaining pending
  const { count } = await client
    .from("corpus_chunks")
    .select("id", { count: "exact", head: true })
    .in("embedding_status", ["pending", "stale"]);

  return {
    embedded,
    pending: count ?? 0,
    ...(failedCount > 0 ? { failed: failedCount } : {}),
  };
}
