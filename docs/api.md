---
title: API Reference
description:
  "TypeScript types, functions, and SQL RPC exports from @panopticon/corpus-pipeline. Complete type
  definitions for corpus ingestion, embedding, and retrieval."
head:
  - - meta
    - property: og:title
      content: API Reference — Panopticon AI
  - - meta
    - property: og:description
      content:
        TypeScript types, functions, and SQL RPC exports for corpus ingestion, embedding,
        watermarking, and retrieval.
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai/api
  - - meta
    - name: keywords
      content:
        API reference, TypeScript types, corpus pipeline API, embedding API, watermark verification,
        match_corpus_chunks, PostgREST RPC
---

# API Reference

All public types and functions exported from `@panopticon/corpus-pipeline`.

## Core Types

### `Corpus`

The shape of a corpus document parsed from Markdown + YAML frontmatter.

```typescript
interface Corpus {
  corpus_id: string;
  title: string;
  tier: string; // "tier_1" | "tier_2" | "tier_3"
  frameworks: string[];
  industries: string[];
  segments: string[];
  source_url: string;
  source_publisher: string;
  last_verified: string;
  version: string;
  content_type?: CorpusContentType; // "prose" | "boundary" | "structured"
  language?: string;
  fact_check?: CorpusFactCheck;
  sire?: CorpusSire; // S.I.R.E. identity-first retrieval metadata
  content: string; // Raw markdown body (no frontmatter)
  filePath: string;
}
```

### `CorpusSire`

S.I.R.E. identity-first retrieval metadata for deterministic post-retrieval enforcement. Optional —
corpora without it bypass gating entirely. See the [S.I.R.E. guide](/sire) for full documentation.

```typescript
interface CorpusSire {
  /** Taxonomic identity anchor — domain label (e.g. "data_protection"). */
  subject: string;
  /** Editorial keywords inside this subject domain. Informs search, never vetoes. */
  included: string[];
  /** Anti-keywords that strictly disqualify chunks at runtime. The sole enforcement gate. */
  excluded: string[];
  /** Cross-framework IDs and version aliases for topological expansion. */
  relevant: string[];
}
```

All four fields are required when `sire` is present. `excluded` and `relevant` may be empty arrays.

### `CorpusChunkRaw`

Output from the chunking algorithm.

```typescript
interface CorpusChunkRaw {
  sequence: number; // 0-indexed position
  section_title: string; // Heading text
  heading_level: number; // 2 = H2, 3 = H3
  content: string; // Full chunk content including heading
  content_hash: string; // SHA-256 of content
  token_count: number; // Approximate word count
  heading_path: string[]; // Nesting path, e.g. ["Encryption", "At Rest"]
}
```

### `SovereigntyContext`

Required for all embedding operations. Prevents un-attributed vector generation.

```typescript
interface SovereigntyContext {
  /** Pipeline run UUID — registered via start_pipeline_run() */
  runId: string;
  /** Registered embedding authority UUID */
  embeddingAuthorityId: string;
  /** Active egress policy UUID */
  egressPolicyId: string;
  /** Organization scope (null = platform) */
  organizationId?: string;
  /** Who triggered the run (e.g. "cli", "admin-ui") */
  triggeredBy: string;
  /** Authenticated user UUID (null for CLI/service) */
  userId?: string;
}
```

### `PendingChunk`

Shape returned by `claim_corpus_chunks_for_embedding()`.

```typescript
interface PendingChunk {
  chunk_id: string;
  document_id: string;
  corpus_id: string;
  section_title: string;
  content: string;
  language: string;
  content_hash: string;
}
```

## Pipeline Types

### `CorpusPipelineAction`

```typescript
type CorpusPipelineAction =
  | "validate"
  | "ingest"
  | "ingest_and_embed"
  | "embed_pending"
  | "rechunk"
  | "ingest_content";
```

### `CorpusPipelineRequest`

```typescript
interface CorpusPipelineRequest {
  action: CorpusPipelineAction;
  corpus_id?: string;
  content?: string; // Raw markdown for ingest_content
}
```

### `CorpusPipelineResponse`

```typescript
interface CorpusPipelineResponse {
  action: CorpusPipelineAction;
  results?: CorpusPipelineResult[];
  validations?: CorpusValidationResult[];
  embedding?: CorpusEmbedResult;
  summary: CorpusPipelineSummary;
}
```

### `CorpusPipelineSummary`

```typescript
interface CorpusPipelineSummary {
  total: number;
  valid: number;
  ingested: number;
  embedded: number;
  errors: number;
}
```

## Options Types

### `IngestOptions`

```typescript
interface IngestOptions {
  dryRun?: boolean; // Validate only, no writes
  requireFactCheck?: boolean; // Require verified fact_check (default: true)
  organizationId?: string; // Tenant scope
  ingestedBy?: string; // Audit label
  forceRechunk?: boolean; // Rechunk even if unchanged
  existing?: ExistingDocument | null;
}
```

### `EmbedOptions`

```typescript
interface EmbedOptions {
  openaiApiKey: string;
  sovereignty: SovereigntyContext;
  maxWaitMs?: number; // Timeout (for Vercel functions)
  dryRun?: boolean; // Count pending, don't embed
}
```

### `PipelineOptions`

```typescript
interface PipelineOptions extends IngestOptions {
  openaiApiKey?: string;
  sovereignty?: SovereigntyContext;
  skipEmbed?: boolean;
  maxEmbedWaitMs?: number;
  onProgress?: (step: string, detail: string) => void;
}
```

## Functions

### `executePipelineRequest()`

Top-level entry point. Validates, ingests, and/or embeds based on the action.

```typescript
function executePipelineRequest(options: {
  client: SupabaseClient;
  request: CorpusPipelineRequest;
  openaiApiKey?: string;
  sovereignty?: SovereigntyContext;
  organizationId?: string;
}): Promise<CorpusPipelineResponse>;
```

### `registerPipelineRun()`

Registers a pipeline run in the sovereignty attestation table. Must be called before
`embedDocumentChunks()`.

```typescript
function registerPipelineRun(
  client: SupabaseClient,
  sovereignty: SovereigntyContext,
): Promise<void>;
```

### `runPipeline()`

Orchestrates validate → ingest → embed for a single corpus.

```typescript
function runPipeline(
  client: SupabaseClient,
  corpus: Corpus,
  options?: PipelineOptions,
): Promise<PipelineResult>;
```

### `runFullPipeline()`

Runs `runPipeline()` against all corpora.

```typescript
function runFullPipeline(
  client: SupabaseClient,
  corpora: Corpus[],
  options?: PipelineOptions,
): Promise<PipelineResult[]>;
```

### `validateCorpus()`

Validates a single corpus's frontmatter and content.

```typescript
function validateCorpus(corpus: Corpus): CorpusValidationResult;
```

### `ingestCorpus()`

Upserts a corpus document and generates chunks.

```typescript
function ingestCorpus(
  client: SupabaseClient,
  corpus: Corpus,
  options?: IngestOptions,
): Promise<CorpusIngestResult>;
```

### `embedDocumentChunks()`

Embeds all pending chunks for a specific document.

```typescript
function embedDocumentChunks(
  client: SupabaseClient,
  documentId: string,
  options: EmbedOptions,
): Promise<CorpusEmbedResult>;
```

### `embedPendingChunks()`

Embeds all globally pending chunks (across all documents).

```typescript
function embedPendingChunks(
  client: SupabaseClient,
  options: EmbedOptions,
): Promise<CorpusEmbedResult>;
```

## Content Helpers

### `parseCorpusContent()`

Parses a raw Markdown string (frontmatter + body) into an `Corpus` object.

```typescript
function parseCorpusContent(raw: string, filePath: string): Corpus;
```

### `chunkCorpus()`

Splits a corpus's content body into heading-aware chunks.

```typescript
function chunkCorpus(corpus: Corpus): CorpusChunkRaw[];
```

### `hashCorpusContent()`

Returns the SHA-256 hash of the corpus's content body.

```typescript
function hashCorpusContent(content: string): string;
```

### `hasSubstantiveChanges()`

Compares a corpus against an existing document to detect substantive changes (content hash, version,
title, tier, frameworks, etc.).

```typescript
function hasSubstantiveChanges(corpus: Corpus, existing: ExistingDocument): boolean;
```

## Envelope Functions

### `recordPipelineEnvelope()`

Records an audit envelope for a pipeline run.

```typescript
function recordPipelineEnvelope(client: SupabaseClient, context: EnvelopeContext): Promise<void>;
```

### `recordEmbedEnvelope()`

Records an envelope specifically for embedding operations.

```typescript
function recordEmbedEnvelope(client: SupabaseClient, context: EnvelopeContext): Promise<void>;
```

### `recordErrorEnvelope()`

Records an envelope for pipeline errors.

```typescript
function recordErrorEnvelope(
  client: SupabaseClient,
  context: EnvelopeContext,
  error: Error,
): Promise<void>;
```

## Provenance Watermarking

### `WatermarkParams`

Input for watermark generation.

```typescript
interface WatermarkParams {
  corpusId: string;
  sequence: number;
  /** SHA-256 hex of the original (un-watermarked) chunk content */
  contentHash: string;
  /** Optional HMAC secret. Uses HMAC-SHA256 instead of plain SHA-256 when set. */
  secret?: string;
}
```

### `WatermarkPayload`

Extracted watermark data.

```typescript
interface WatermarkPayload {
  version: string; // "v1"
  corpusId: string; // e.g. "gdpr-core-v1"
  sequence: number; // chunk sequence within document
  signature: string; // 16-char hex signature
}
```

### `WatermarkVerification`

Result of verifying a chunk's watermark.

```typescript
interface WatermarkVerification {
  valid: boolean;
  payload: WatermarkPayload | null;
  reason?: string; // If invalid, explains why
}
```

### `injectWatermark()`

Inject a provenance watermark into chunk content. Idempotent — re-injection produces the same
result.

```typescript
function injectWatermark(content: string, params: WatermarkParams): string;
```

### `verifyChunkWatermark()`

Verify a chunk's watermark integrity. Self-contained — no database access needed.

```typescript
function verifyChunkWatermark(content: string, secret?: string): WatermarkVerification;
```

**Verification loop:** Extract watermark → strip it → SHA-256 the stripped content → recompute
expected signature → compare.

### `extractWatermark()`

Extract the watermark payload from chunk content, or `null` if absent.

```typescript
function extractWatermark(content: string): WatermarkPayload | null;
```

### `stripWatermark()`

Remove the watermark comment from chunk content. Returns the original un-watermarked content.

```typescript
function stripWatermark(content: string): string;
```

### `generateSignature()`

Generate the watermark signature. First 16 hex chars of SHA-256 (or HMAC-SHA-256 with secret).

```typescript
function generateSignature(params: WatermarkParams): string;
```

### `buildWatermarkComment()`

Generate the full watermark HTML comment string.

```typescript
function buildWatermarkComment(params: WatermarkParams): string;
// → "<!-- corpus-watermark:v1:gdpr-core-v1:3:a1b2c3d4e5f67890 -->"
```

### Watermark Constants

| Constant            | Value                          | Description                      |
| ------------------- | ------------------------------ | -------------------------------- |
| `WATERMARK_VERSION` | `v1`                           | Current watermark format version |
| `WATERMARK_PREFIX`  | `corpus-watermark`             | Comment prefix for detection     |
| `WATERMARK_REGEX`   | `/<!-- corpus-watermark:...>/` | Regex to extract watermark       |

## Concurrency Utilities

### `mapWithConcurrency()`

Maps an array through an async function with bounded concurrency.

```typescript
function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]>;
```

### `mapSettledWithConcurrency()`

Like `mapWithConcurrency` but returns `PromiseSettledResult` for each item.

```typescript
function mapSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]>;
```

## Constants

| Constant                 | Value                    | Description                      |
| ------------------------ | ------------------------ | -------------------------------- |
| `EMBEDDING_MODEL`        | `text-embedding-3-large` | OpenAI model                     |
| `EMBEDDING_DIMENSIONS`   | `512`                    | Matryoshka truncation            |
| `CHUNK_BATCH_SIZE`       | `50`                     | Chunks per Supabase batch insert |
| `EMBED_BATCH_SIZE`       | `20`                     | Texts per OpenAI API call        |
| `FETCH_BATCH_SIZE`       | `100`                    | Chunks per page fetch            |
| `CLAIM_BATCH_SIZE`       | `50`                     | Chunks per claim RPC             |
| `LEASE_SECONDS`          | `600`                    | Lease duration (seconds)         |
| `EMBED_RETRY_BASE_MS`    | `1000`                   | Backoff base (ms)                |
| `EMBED_MAX_RETRIES`      | `2`                      | Max retries on transient errors  |
| `PIPELINE_CONCURRENCY`   | `3`                      | Concurrent corpus processing     |
| `EXTRACTION_CONCURRENCY` | `5`                      | Concurrent Tavily extractions    |
