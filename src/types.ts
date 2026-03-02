/**
 * Pipeline result types for corpus validation, ingestion, and embedding.
 */

// Re-export SupabaseClient type for callers
export type { SupabaseClient } from "@supabase/supabase-js";

// ─── Corpus Pipeline API types (inlined) ────────────────────────────────────

export type CorpusContentType = "prose" | "boundary" | "structured";

export interface CorpusFactCheck {
  status: string;
  checked_at: string;
  checked_by: string;
  notes?: string;
}

/** S.I.R.E. identity-first retrieval metadata for deterministic post-retrieval enforcement. */
export interface CorpusSire {
  /** Taxonomic identity anchor — domain label (e.g. "data_protection"). */
  subject: string;
  /** Editorial keywords explicitly mapped inside this subject domain. Informs search, never vetoes. */
  included: string[];
  /** Anti-keywords that strictly disqualify chunks at runtime. The sole deterministic enforcement gate. */
  excluded: string[];
  /** Cross-framework IDs and version aliases for topological expansion. */
  relevant: string[];
}

/** Corpus document shape. */
export interface Corpus {
  corpus_id: string;
  title: string;
  tier: string;
  frameworks: string[];
  industries: string[];
  segments: string[];
  source_url: string;
  source_publisher: string;
  last_verified: string;
  version: string;
  content_type?: CorpusContentType;
  language?: string;
  fact_check?: CorpusFactCheck;
  /** S.I.R.E. identity-first retrieval metadata. Optional — corpora without it bypass gating. */
  sire?: CorpusSire;
  content: string;
  filePath: string;
}

/** Raw chunk output from chunkCorpus. */
export interface CorpusChunkRaw {
  sequence: number;
  section_title: string;
  heading_level: number;
  content: string;
  content_hash: string;
  token_count: number;
  heading_path: string[];
}

export type CorpusPipelineAction =
  | "validate"
  | "ingest"
  | "ingest_and_embed"
  | "embed_pending"
  | "rechunk"
  | "ingest_content"
  | "parse"
  | "approve_draft";

export interface CorpusPipelineRequest {
  action: CorpusPipelineAction;
  corpus_id?: string;
  /** Raw markdown content for ingest_content action (frontmatter + body) */
  content?: string;
}

export interface CorpusValidationResult {
  corpus_id: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export type CorpusIngestAction =
  | "inserted"
  | "updated"
  | "unchanged"
  | "blocked";

export interface CorpusIngestResult {
  document_id: string;
  corpus_id: string;
  action: CorpusIngestAction;
  chunk_count: number;
  validation: CorpusValidationResult;
}

export interface CorpusEmbedResult {
  embedded: number;
  pending: number;
}

export interface CorpusPipelineResult {
  corpus_id: string;
  validation: CorpusValidationResult;
  ingestion: CorpusIngestResult | null;
  embedding: CorpusEmbedResult | null;
}

export interface CorpusPipelineSummary {
  total: number;
  valid: number;
  ingested: number;
  embedded: number;
  errors: number;
}

export interface CorpusPipelineResponse {
  action: CorpusPipelineAction;
  results?: CorpusPipelineResult[];
  validations?: CorpusValidationResult[];
  embedding?: CorpusEmbedResult;
  summary: CorpusPipelineSummary;
}

// ─── Validation ─────────────────────────────────────────────────────────────

export type ValidationResult = CorpusValidationResult;

// ─── Ingestion ──────────────────────────────────────────────────────────────

export interface IngestOptions {
  /** If true, validate but do not write to Supabase */
  dryRun?: boolean;
  /** Require fact_check.status === "verified" for substantive changes (default: true) */
  requireFactCheck?: boolean;
  /** Organization ID for tenant-scoped corpora */
  organizationId?: string;
  /** Label for who performed the ingestion */
  ingestedBy?: string;
  /** Force rechunking even if content_hash hasn't changed */
  forceRechunk?: boolean;
  /** Pre-fetched existing document (avoids redundant query when caller already has it) */
  existing?: ExistingDocument | null;
  /** Enable provenance watermarking of chunk content (default: true, or WATERMARK_ENABLED env) */
  watermark?: boolean;
  /** HMAC secret for watermark signatures. Uses HMAC-SHA256 instead of plain SHA-256 when set. */
  watermarkSecret?: string;
}

export type IngestResult = CorpusIngestResult;

// ─── Sovereignty ────────────────────────────────────────────────────────────

/** VPC sovereignty context required for all embedding operations. */
export interface SovereigntyContext {
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

// ─── Embedding ──────────────────────────────────────────────────────────────

export interface EmbedOptions {
  /** OpenAI API key for embedding generation */
  openaiApiKey: string;
  /** VPC sovereignty context (required — no un-attributed embeddings) */
  sovereignty: SovereigntyContext;
  /** Stop processing after this many ms (for Vercel timeout) */
  maxWaitMs?: number;
  /** If true, count pending chunks but don't generate embeddings */
  dryRun?: boolean;
}

export interface EmbedResult extends CorpusEmbedResult {
  /** Number of chunks that permanently failed embedding (marked 'failed' in DB) */
  failed?: number;
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export interface PipelineOptions extends IngestOptions {
  /** OpenAI API key (required unless skipEmbed or dryRun) */
  openaiApiKey?: string;
  /** VPC sovereignty context (required for embedding) */
  sovereignty?: SovereigntyContext;
  /** Skip embedding step */
  skipEmbed?: boolean;
  /** Max time for embedding per document (ms) */
  maxEmbedWaitMs?: number;
  /** Progress callback */
  onProgress?: (step: string, detail: string) => void;
}

export type PipelineResult = CorpusPipelineResult;

// ─── API Execution ───────────────────────────────────────────────────────────

export type PipelineExecutionAction = CorpusPipelineAction;
export type PipelineExecutionRequest = CorpusPipelineRequest;
export type PipelineExecutionSummary = CorpusPipelineSummary;
export type PipelineExecutionResponse = CorpusPipelineResponse;

// ─── Parse (Document Upload + AI Parse) ─────────────────────────────────

export type ParseDraftStatus =
  | "pending"
  | "parsing"
  | "parsed"
  | "approved"
  | "rejected"
  | "failed";

export type ParsePromptProfile = "published_standard" | "interpretation";

/** Options for submitting a document for AI parsing. */
export interface ParseOptions {
  /** OpenRouter API key */
  openrouterApiKey: string;
  /** Override the default parse model */
  model?: string;
  /** Original filename of the uploaded document */
  sourceFileName?: string;
  /** Organization ID for multi-tenant scoping */
  organizationId?: string;
  /** User ID of the submitter */
  userId?: string;
  /** Hints to guide the AI parser */
  hints?: {
    tier?: string;
    frameworks?: string[];
    industries?: string[];
    sourceUrl?: string;
    sourcePublisher?: string;
  };
  /** Prompt profile to control parse behavior for source type */
  parsePromptProfile?: ParsePromptProfile;
  /** Skip DB write — return parsed result only */
  dryRun?: boolean;
}

/** Result of submitting a document for parsing. */
export interface ParseResult {
  draftId: string;
  parsedMarkdown: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Options for approving a parse draft. */
export interface ApproveDraftOptions extends IngestOptions {
  /** OpenAI API key (required if embedding after approval) */
  openaiApiKey?: string;
  /** Sovereignty context (required for embedding) */
  sovereignty?: SovereigntyContext;
  /** Skip embedding after ingestion */
  skipEmbed?: boolean;
}

/** Result of approving a parse draft. */
export interface ApproveDraftResult {
  draftId: string;
  ingestion: CorpusIngestResult;
  embedding?: CorpusEmbedResult;
}

// ─── Sessions (Multi-Document Parse Batches) ─────────────────────────────

export type SessionStatus =
  | "uploading"
  | "complete"
  | "crosswalk_pending"
  | "crosswalk_done"
  | "archived";

export type SessionDocumentStatus =
  | "pending"
  | "parsing"
  | "parsed"
  | "edited"
  | "failed"
  | "chunked"
  | "watermarked";

/** A parse session grouping multiple document uploads. */
export interface CorpusSession {
  id: string;
  organization_id: string | null;
  created_by: string | null;
  name: string;
  status: SessionStatus;
  is_public: boolean;
  crosswalk_markdown: string | null;
  crosswalk_chunks_json: CorpusChunkRaw[] | null;
  crosswalk_model: string | null;
  crosswalk_tokens_in: number | null;
  crosswalk_tokens_out: number | null;
  created_at: string;
  updated_at: string;
}

/** A document within a parse session. */
export interface SessionDocument {
  id: string;
  session_id: string;
  organization_id: string | null;
  source_filename: string;
  source_text: string;
  source_hash: string;
  parsed_markdown: string | null;
  parse_model: string | null;
  parse_tokens_in: number | null;
  parse_tokens_out: number | null;
  status: SessionDocumentStatus;
  user_markdown: string | null;
  error_message: string | null;
  /** Chunk objects from chunkCorpus(). Updated with watermarks after watermark stage. */
  chunks_json: CorpusChunkRaw[] | null;
  /** Count of omission/recovery warnings from chunk-audit stage. */
  audit_warning_count?: number | null;
  /** Short warning preview from chunk-audit stage. */
  audit_warning_preview?: string[] | null;
  /** Latest parse job telemetry from corpus_jobs for this document. */
  parse_job?: {
    id: number;
    status: "pending" | "in_progress" | "done" | "failed";
    retry_count: number;
    max_retries: number;
    updated_at: string;
    error: string | null;
    step?: string | null;
    message?: string | null;
  } | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /** Set when document is promoted to the Encyclopedia. */
  promoted_at: string | null;
}

export interface SessionQualityMetrics {
  parseAccuracy: number;
  chunkCoverage: number;
  watermarkIntegrity: number;
  promotionReadiness: number;
  overall: number;
}

export interface SessionQualitySnapshotPayload {
  quality: SessionQualityMetrics;
  gatePass: {
    parse: boolean;
    chunk: boolean;
    watermark: boolean;
    promote: boolean;
  };
  counts: {
    totalDocs: number;
    promotedWatermarkedDocs: number;
  };
  canGenerateCrosswalk: boolean;
  sessionStatus: SessionStatus;
  crosswalkPresent: boolean;
}

export interface SourceChunkRecord {
  sequence: number;
  source_text: string;
  source_hash: string;
  chunk_strategy: string;
}

export interface ChunkAuditRecord {
  sequence: number;
  source_hash: string;
  ai_hash: string;
  coverage_ratio: number;
  omission_detected: boolean;
  recovered_from_source: boolean;
  source_text: string;
  ai_text: string;
  recovered_text: string;
  warnings: string[];
}

/** Options for creating a new parse session. */
export interface CreateSessionOptions {
  name?: string;
  organizationId?: string;
  userId?: string;
}

/** Options for adding a document to a session and parsing it. */
export interface SessionParseOptions {
  /** OpenRouter API key */
  openrouterApiKey: string;
  /** Override the default parse model */
  model?: string;
  /** Original filename of the uploaded document */
  sourceFileName?: string;
  /** Organization ID for multi-tenant scoping */
  organizationId?: string;
  /** User ID of the submitter */
  userId?: string;
  /** Hints to guide the AI parser */
  hints?: {
    tier?: string;
    frameworks?: string[];
    industries?: string[];
    sourceUrl?: string;
    sourcePublisher?: string;
  };
  /** Prompt profile to control parse behavior for source type */
  parsePromptProfile?: ParsePromptProfile;
  /** Optional parse progress callback for worker telemetry */
  onProgress?: (progress: {
    step: string;
    message: string;
    details?: Record<string, unknown>;
  }) => Promise<void> | void;
}

/** Result of adding and parsing a document in a session. */
export interface SessionParseResult {
  documentId: string;
  parsedMarkdown: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalSourceChunks: number;
  omissionChunkCount: number;
  recoveredChunkCount: number;
  auditWarnings: string[];
}

/** Options for generating a crosswalk across session documents. */
export interface GenerateCrosswalkOptions {
  /** OpenRouter API key */
  openrouterApiKey: string;
  /** Override the default crosswalk model */
  model?: string;
}

/** Result of crosswalk generation. */
export interface CrosswalkResult {
  crosswalkMarkdown: string;
  crosswalkChunks: CorpusChunkRaw[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// ─── Encyclopedia (Persistent Document Library) ───────────────────────────

/** A document promoted to the persistent Encyclopedia library. */
export interface EncyclopediaEntry {
  id: string;
  created_by: string | null;
  organization_id: string | null;
  corpus_id: string;
  title: string;
  tier: string;
  frameworks: string[];
  industries: string[];
  segments: string[];
  source_filename: string;
  markdown: string;
  chunks_json: CorpusChunkRaw[] | null;
  source_session_id: string | null;
  source_document_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Internal ───────────────────────────────────────────────────────────────

/** Shape of an existing corpus_documents row from Supabase */
export interface ExistingDocument {
  id: string;
  corpus_id: string;
  version: string;
  content_hash: string;
  tier: string;
  content_type: string;
  frameworks: string[];
  industries: string[];
  segments: string[];
  source_url: string;
  source_publisher: string;
  last_verified: string;
  title: string;
  language: string;
}

/** Minimal chunk row shape returned by claim_corpus_chunks_for_embedding() */
export interface PendingChunk {
  /** chunk_id (renamed from claim function) */
  chunk_id: string;
  document_id: string;
  corpus_id: string;
  section_title: string;
  content: string;
  language: string;
  content_hash: string;
}
