/**
 * Pipeline Envelope Recorder — observability for corpus pipeline operations.
 *
 * Records an immutable audit trail in corpus_pipeline_envelopes for every
 * pipeline action (validate, ingest, embed, rechunk). Mirrors the
 * goober_chat_envelopes pattern for governance compliance.
 *
 * Callers create an EnvelopeContext with a shared runId, then pass it through
 * pipeline execution. Each corpus's result gets its own envelope row.
 */

import type {
  EmbedResult,
  PipelineExecutionAction,
  PipelineResult,
  SovereigntyContext,
  SupabaseClient,
} from "./types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EnvelopeContext {
  /** Supabase client for persistence */
  client: SupabaseClient;
  /** UUID grouping all corpora in this pipeline run */
  runId: string;
  /** Who triggered: "cli" | "admin-ui" | "corpus-builder" */
  triggeredBy: string;
  /** Authenticated user ID (null for CLI) */
  userId?: string;
  /** Pipeline action being performed */
  action: PipelineExecutionAction;
  /** VPC sovereignty context for attribution columns */
  sovereignty?: SovereigntyContext;
}

export interface RechunkMeta {
  rechunk: true;
  old_chunk_count: number;
  new_chunk_count: number;
  changed_sections?: string[];
}

// ─── Envelope Recording ─────────────────────────────────────────────────────

/** Max retry attempts for envelope writes (non-blocking) */
const MAX_ATTEMPTS = 2;

/**
 * Record a single pipeline result as an envelope row.
 * Non-blocking — logs errors but does not throw.
 */
export async function recordPipelineEnvelope(
  ctx: EnvelopeContext,
  corpusId: string | null,
  result: PipelineResult,
  startedAt: Date,
  rechunkMeta?: RechunkMeta,
): Promise<void> {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const payload = {
    run_id: ctx.runId,
    triggered_by: ctx.triggeredBy,
    user_id: ctx.userId ?? null,
    action: ctx.action,
    corpus_id: corpusId ?? result.corpus_id,
    organization_id: ctx.sovereignty?.organizationId ?? null,
    embedding_authority_id: ctx.sovereignty?.embeddingAuthorityId ?? null,
    egress_policy_id: ctx.sovereignty?.egressPolicyId ?? null,
    attestation_run_id: ctx.sovereignty?.runId ?? null,
    validation: result.validation
      ? {
        corpus_id: result.validation.corpus_id,
        valid: result.validation.valid,
        errors: result.validation.errors,
        warnings: result.validation.warnings,
      }
      : null,
    ingestion: result.ingestion
      ? {
        document_id: result.ingestion.document_id,
        corpus_id: result.ingestion.corpus_id,
        action: result.ingestion.action,
        chunk_count: result.ingestion.chunk_count,
      }
      : null,
    embedding: result.embedding
      ? {
        embedded: result.embedding.embedded,
        pending: result.embedding.pending,
      }
      : null,
    validation_valid: result.validation?.valid ?? null,
    ingestion_action: result.ingestion?.action ?? null,
    chunk_count: result.ingestion?.chunk_count ?? null,
    embedded_count: result.embedding?.embedded ?? null,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: durationMs,
    error: null,
    rechunk_meta: rechunkMeta ?? null,
  };

  await writeEnvelope(ctx.client, payload);
}

/**
 * Record a batch embed operation as a single envelope row.
 */
export async function recordEmbedEnvelope(
  ctx: EnvelopeContext,
  result: EmbedResult,
  startedAt: Date,
): Promise<void> {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const payload = {
    run_id: ctx.runId,
    triggered_by: ctx.triggeredBy,
    user_id: ctx.userId ?? null,
    action: ctx.action,
    corpus_id: null,
    organization_id: ctx.sovereignty?.organizationId ?? null,
    embedding_authority_id: ctx.sovereignty?.embeddingAuthorityId ?? null,
    egress_policy_id: ctx.sovereignty?.egressPolicyId ?? null,
    attestation_run_id: ctx.sovereignty?.runId ?? null,
    validation: null,
    ingestion: null,
    embedding: { embedded: result.embedded, pending: result.pending },
    validation_valid: null,
    ingestion_action: null,
    chunk_count: null,
    embedded_count: result.embedded,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: durationMs,
    error: null,
    rechunk_meta: null,
  };

  await writeEnvelope(ctx.client, payload);
}

/**
 * Record a pipeline error as an envelope row.
 */
export async function recordErrorEnvelope(
  ctx: EnvelopeContext,
  corpusId: string | null,
  error: unknown,
  startedAt: Date,
): Promise<void> {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const payload = {
    run_id: ctx.runId,
    triggered_by: ctx.triggeredBy,
    user_id: ctx.userId ?? null,
    action: ctx.action,
    corpus_id: corpusId,
    organization_id: ctx.sovereignty?.organizationId ?? null,
    embedding_authority_id: ctx.sovereignty?.embeddingAuthorityId ?? null,
    egress_policy_id: ctx.sovereignty?.egressPolicyId ?? null,
    attestation_run_id: ctx.sovereignty?.runId ?? null,
    validation: null,
    ingestion: null,
    embedding: null,
    validation_valid: null,
    ingestion_action: null,
    chunk_count: null,
    embedded_count: null,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: durationMs,
    error: error instanceof Error ? error.message : String(error),
    rechunk_meta: null,
  };

  await writeEnvelope(ctx.client, payload);
}

// ─── Internal ───────────────────────────────────────────────────────────────

async function writeEnvelope(
  client: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { error } = await client
      .from("corpus_pipeline_envelopes")
      .insert(payload);

    if (!error) return;

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    } else {
      console.error(
        `[corpus-pipeline] Failed to write envelope after ${
          String(MAX_ATTEMPTS)
        } attempts:`,
        error.message,
      );
    }
  }
}
