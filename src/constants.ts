/**
 * Shared constants for the corpus pipeline.
 *
 * Centralizes embedding model names, dimensions, and batch sizes
 * that were previously duplicated across scripts and app modules.
 */

/** OpenAI embedding model used for corpus chunk vectors */
export const EMBEDDING_MODEL = "text-embedding-3-large";

/** Dimensionality of the embedding vectors (Matryoshka truncation) */
export const EMBEDDING_DIMENSIONS = 512;

/** Number of chunks to insert per Supabase batch */
export const CHUNK_BATCH_SIZE = 50;

/** Number of texts to embed per OpenAI API call */
export const EMBED_BATCH_SIZE = 20;

/** Number of chunks to fetch per page from Supabase (backfill) */
export const FETCH_BATCH_SIZE = 100;

// ─── Sovereignty / lease constants ───────────────────────────────────────────

/** Number of chunks to claim per call to claim_corpus_chunks_for_embedding() */
export const CLAIM_BATCH_SIZE = 50;

/** Lease duration in seconds — how long a worker holds a chunk before it's reclaimable */
export const LEASE_SECONDS = 600;

// ─── Retry constants (modeled on openrouter.ts) ──────────────────────────────

/** Base delay for exponential backoff on transient OpenAI failures (ms) */
export const EMBED_RETRY_BASE_MS = 1_000;

/** Max retry attempts for transient OpenAI errors (total attempts = MAX_RETRIES + 1) */
export const EMBED_MAX_RETRIES = 2;

/** HTTP status codes that are safe to retry */
export const TRANSIENT_STATUS_CODES: readonly number[] = [
  429,
  500,
  502,
  503,
  504,
];

// ─── Concurrency constants ───────────────────────────────────────────────────

/** Max corpora processed concurrently in executePipelineRequest */
export const PIPELINE_CONCURRENCY = 3;

/** Max Tavily extractions in flight concurrently in the save route */
export const EXTRACTION_CONCURRENCY = 5;

// ─── Watermark constants ────────────────────────────────────────────────────

/** Length of the hex signature in watermark comments (first N chars of SHA-256/HMAC digest) */
export const WATERMARK_SIGNATURE_LENGTH = 16;

// ─── Parse (OpenRouter) constants ───────────────────────────────────────────

/** Default OpenRouter model for document parsing */
export const PARSE_MODEL_DEFAULT = "anthropic/claude-sonnet-4.6";

/** Base delay for exponential backoff on transient OpenRouter failures (ms) */
export const PARSE_RETRY_BASE_MS = 1_000;

/** Max retry attempts for transient OpenRouter errors (total attempts = MAX_RETRIES + 1) */
export const PARSE_MAX_RETRIES = 2;

/** Default OpenRouter model for crosswalk generation */
export const CROSSWALK_MODEL_DEFAULT = "anthropic/claude-sonnet-4.6";
