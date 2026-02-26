/**
 * API-facing pipeline execution orchestration.
 *
 * This keeps request/action semantics in the package so route handlers stay thin.
 */

import type { Corpus } from "./types";
import { getCorpora, parseCorpusContent } from "./content-helpers";
import { mapWithConcurrency } from "./concurrency";
import { PIPELINE_CONCURRENCY } from "./constants";
import { embedPendingChunks, registerPipelineRun } from "./embed";
import {
  type EnvelopeContext,
  recordEmbedEnvelope,
  recordErrorEnvelope,
  recordPipelineEnvelope,
} from "./envelope";
import { runPipeline } from "./pipeline";
import type {
  PipelineExecutionRequest,
  PipelineExecutionResponse,
  PipelineResult,
  SovereigntyContext,
  SupabaseClient,
  ValidationResult,
} from "./types";
import { validateCorpus } from "./validate";

export class CorpusPipelineExecutionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CorpusPipelineExecutionError";
    this.status = status;
    this.code = code;
  }
}

export interface ExecutePipelineRequestOptions {
  client: SupabaseClient;
  request: PipelineExecutionRequest;
  requireFactCheck?: boolean;
  ingestedBy?: string;
  openaiApiKey?: string;
  maxEmbedWaitMs?: number;
  embedPendingMaxWaitMs?: number;
  loadCorpora?: () => Corpus[];
  /** Envelope context for observability. When provided, records audit trail. */
  envelope?: Omit<EnvelopeContext, "client" | "action">;
  /** VPC sovereignty context (required for embed actions) */
  sovereignty?: SovereigntyContext;
}

function resolveCorpora(
  corpusId: string | undefined,
  loadCorpora: (() => Corpus[]) | undefined,
): Corpus[] {
  const loader = loadCorpora ?? getCorpora;

  let corpora: Corpus[];
  try {
    corpora = loader();
  } catch (error) {
    throw new CorpusPipelineExecutionError(
      500,
      "corpus_load_failed",
      `Failed loading corpora: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!corpusId) return corpora;

  const filtered = corpora.filter((corpus) => corpus.corpus_id === corpusId);
  if (filtered.length === 0) {
    throw new CorpusPipelineExecutionError(
      404,
      "corpus_not_found",
      `Corpus not found: ${corpusId}`,
    );
  }
  return filtered;
}

function buildValidationSummary(validations: ValidationResult[]) {
  const valid = validations.filter((result) => result.valid).length;
  return {
    total: validations.length,
    valid,
    ingested: 0,
    embedded: 0,
    errors: validations.length - valid,
  };
}

function buildPipelineSummary(results: PipelineResult[]) {
  const valid = results.filter((result) => result.validation.valid).length;
  const ingested = results.filter(
    (result) =>
      result.ingestion?.action === "inserted" ||
      result.ingestion?.action === "updated",
  ).length;
  const embedded = results.reduce(
    (total, result) => total + (result.embedding?.embedded ?? 0),
    0,
  );
  const errors = results.filter((result) => !result.validation.valid).length;

  return {
    total: results.length,
    valid,
    ingested,
    embedded,
    errors,
  };
}

export async function executePipelineRequest(
  options: ExecutePipelineRequestOptions,
): Promise<PipelineExecutionResponse> {
  const {
    client,
    request,
    requireFactCheck = true,
    ingestedBy = "corpus-pipeline",
    openaiApiKey,
    maxEmbedWaitMs = 30_000,
    embedPendingMaxWaitMs = 240_000,
    loadCorpora,
    sovereignty,
  } = options;

  const { action, corpus_id: corpusId, content: rawContent } = request;

  // Build envelope context if caller provided one
  const envCtx: EnvelopeContext | null = options.envelope
    ? { ...options.envelope, client, action }
    : null;

  // ── ingest_content: parse inline markdown and run pipeline ──────────────
  if (action === "ingest_content") {
    if (!rawContent) {
      throw new CorpusPipelineExecutionError(
        400,
        "missing_content",
        "ingest_content action requires a 'content' field with raw corpus markdown",
      );
    }

    let corpus: Corpus;
    try {
      corpus = parseCorpusContent(rawContent);
    } catch (error) {
      throw new CorpusPipelineExecutionError(
        400,
        "invalid_content",
        `Failed to parse corpus content: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const corpusStart = new Date();
    try {
      // Register pipeline run for sovereignty if embedding
      if (openaiApiKey && sovereignty) {
        await registerPipelineRun(client, sovereignty);
      }

      const result = await runPipeline(client, corpus, {
        requireFactCheck: false,
        ingestedBy,
        openaiApiKey: openaiApiKey ?? undefined,
        skipEmbed: !openaiApiKey,
        maxEmbedWaitMs,
        sovereignty,
      });

      if (envCtx) {
        await recordPipelineEnvelope(
          envCtx,
          corpus.corpus_id,
          result,
          corpusStart,
        );
      }

      return {
        action,
        results: [result],
        summary: buildPipelineSummary([result]),
      };
    } catch (error) {
      if (envCtx) {
        await recordErrorEnvelope(envCtx, corpus.corpus_id, error, corpusStart);
      }
      throw error;
    }
  }

  if (action === "embed_pending") {
    if (!openaiApiKey) {
      throw new CorpusPipelineExecutionError(
        503,
        "missing_openai_api_key",
        "OPENAI_API_KEY not configured",
      );
    }

    if (!sovereignty) {
      throw new CorpusPipelineExecutionError(
        400,
        "missing_sovereignty",
        "embed_pending requires a sovereignty context — un-attributed embeddings are structurally impossible",
      );
    }

    // Register pipeline run attestation (idempotent)
    await registerPipelineRun(client, sovereignty);

    const embedStart = new Date();
    const embedding = await embedPendingChunks(client, {
      openaiApiKey,
      sovereignty,
      maxWaitMs: embedPendingMaxWaitMs,
    });

    if (envCtx) {
      await recordEmbedEnvelope(envCtx, embedding, embedStart);
    }

    return {
      action,
      embedding,
      summary: {
        total: embedding.embedded + embedding.pending,
        valid: 0,
        ingested: 0,
        embedded: embedding.embedded,
        errors: 0,
      },
    };
  }

  const corpora = resolveCorpora(corpusId, loadCorpora);

  if (action === "validate") {
    const validations = corpora.map((corpus) =>
      validateCorpus(corpus, { requireFactCheck })
    );

    // Record validation-only envelopes
    if (envCtx) {
      for (const v of validations) {
        const now = new Date();
        await recordPipelineEnvelope(
          envCtx,
          v.corpus_id,
          {
            corpus_id: v.corpus_id,
            validation: v,
            ingestion: null,
            embedding: null,
          },
          now,
        );
      }
    }

    return {
      action,
      validations,
      summary: buildValidationSummary(validations),
    };
  }

  // ── rechunk: force re-ingestion even when content_hash unchanged ─────────
  if (action === "rechunk") {
    if (!corpusId) {
      throw new CorpusPipelineExecutionError(
        400,
        "missing_corpus_id",
        "rechunk action requires an corpus_id",
      );
    }

    const rechunkCorpora = resolveCorpora(corpusId, loadCorpora);

    const rechunkResults = await mapWithConcurrency(
      rechunkCorpora,
      PIPELINE_CONCURRENCY,
      async (corpus) => {
        const corpusStart = new Date();
        try {
          // Register pipeline run for sovereignty if embedding
          if (openaiApiKey && sovereignty) {
            await registerPipelineRun(client, sovereignty);
          }

          const result = await runPipeline(client, corpus, {
            requireFactCheck: false,
            ingestedBy,
            forceRechunk: true,
            openaiApiKey: openaiApiKey ?? undefined,
            skipEmbed: !openaiApiKey,
            maxEmbedWaitMs,
            sovereignty,
          });

          if (envCtx) {
            await recordPipelineEnvelope(
              envCtx,
              corpus.corpus_id,
              result,
              corpusStart,
            );
          }

          return result;
        } catch (error) {
          if (envCtx) {
            await recordErrorEnvelope(
              envCtx,
              corpus.corpus_id,
              error,
              corpusStart,
            );
          }
          throw error;
        }
      },
    );

    return {
      action,
      results: rechunkResults,
      summary: buildPipelineSummary(rechunkResults),
    };
  }

  const skipEmbed = action === "ingest" || !openaiApiKey;

  const results = await mapWithConcurrency(
    corpora,
    PIPELINE_CONCURRENCY,
    async (corpus) => {
      const corpusStart = new Date();
      try {
        // Register pipeline run for sovereignty if embedding
        if (!skipEmbed && sovereignty) {
          await registerPipelineRun(client, sovereignty);
        }

        const result = await runPipeline(client, corpus, {
          requireFactCheck,
          ingestedBy,
          openaiApiKey: openaiApiKey ?? undefined,
          skipEmbed,
          maxEmbedWaitMs,
          sovereignty,
        });

        if (envCtx) {
          await recordPipelineEnvelope(
            envCtx,
            corpus.corpus_id,
            result,
            corpusStart,
          );
        }

        return result;
      } catch (error) {
        if (envCtx) {
          await recordErrorEnvelope(
            envCtx,
            corpus.corpus_id,
            error,
            corpusStart,
          );
        }
        throw error;
      }
    },
  );

  return {
    action,
    results,
    summary: buildPipelineSummary(results),
  };
}
