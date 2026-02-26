/**
 * Corpus Pipeline Orchestrator — validate → ingest → embed
 *
 * Provides single-corpus and full-corpus pipeline execution.
 * Used by both CLI scripts and the admin API route.
 */

import type {
  Corpus,
  PipelineOptions,
  PipelineResult,
  SupabaseClient,
} from "./types";
import { mapWithConcurrency } from "./concurrency";
import { PIPELINE_CONCURRENCY } from "./constants";
import { validateCorpus } from "./validate";
import { fetchExistingDocument, ingestCorpus } from "./ingest";
import { embedDocumentChunks } from "./embed";

/**
 * Run the full pipeline for a single corpus: validate → ingest → embed.
 */
export async function runPipeline(
  client: SupabaseClient,
  corpus: Corpus,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const {
    dryRun = false,
    requireFactCheck = true,
    organizationId,
    ingestedBy = "corpus-pipeline",
    forceRechunk = false,
    openaiApiKey,
    skipEmbed = false,
    maxEmbedWaitMs,
    onProgress,
  } = options;

  const corpusId = corpus.corpus_id;

  // ── Step 1: Validate ────────────────────────────────────────────────────

  onProgress?.("validate", corpusId);

  const existing = await fetchExistingDocument(client, corpusId);
  const validation = validateCorpus(corpus, {
    requireFactCheck,
    existing,
  });

  if (!validation.valid) {
    return {
      corpus_id: corpusId,
      validation,
      ingestion: null,
      embedding: null,
    };
  }

  // ── Step 2: Ingest ──────────────────────────────────────────────────────

  onProgress?.("ingest", corpusId);

  // Pass pre-fetched `existing` so ingestCorpus skips its own fetch (saves 1 round-trip)
  const ingestion = await ingestCorpus(client, corpus, {
    dryRun,
    requireFactCheck,
    organizationId,
    ingestedBy,
    forceRechunk,
    existing,
  });

  // Skip embedding if blocked, unchanged, or dry run
  if (
    ingestion.action === "blocked" ||
    ingestion.action === "unchanged" ||
    dryRun
  ) {
    return {
      corpus_id: corpusId,
      validation,
      ingestion,
      embedding: null,
    };
  }

  // ── Step 3: Embed ───────────────────────────────────────────────────────

  if (skipEmbed || !openaiApiKey) {
    return {
      corpus_id: corpusId,
      validation,
      ingestion,
      embedding: null,
    };
  }

  onProgress?.("embed", corpusId);

  if (!options.sovereignty) {
    throw new Error(
      "sovereignty context is required for embedding — call start_pipeline_run() first",
    );
  }

  const embedding = await embedDocumentChunks(client, ingestion.document_id, {
    openaiApiKey,
    sovereignty: options.sovereignty,
    maxWaitMs: maxEmbedWaitMs,
  });

  return {
    corpus_id: corpusId,
    validation,
    ingestion,
    embedding,
  };
}

/**
 * Run the pipeline for a list of corpora.
 *
 * Optionally filter to a single corpus by ID.
 */
export async function runFullPipeline(
  client: SupabaseClient,
  allCorpora: Corpus[],
  options: PipelineOptions & { only?: string } = {},
): Promise<PipelineResult[]> {
  const { only, onProgress, ...pipelineOptions } = options;

  let corpora = allCorpora;

  if (only) {
    corpora = corpora.filter((o: Corpus) => o.corpus_id === only);
    if (corpora.length === 0) {
      throw new Error(
        `No corpus found with ID "${only}". Available: ${
          allCorpora
            .map((o: Corpus) => o.corpus_id)
            .sort()
            .join(", ")
        }`,
      );
    }
  }

  return mapWithConcurrency(
    corpora,
    PIPELINE_CONCURRENCY,
    async (corpus: Corpus, index: number) => {
      onProgress?.(
        "start",
        `${corpus.corpus_id} (${String(index + 1)}/${String(corpora.length)})`,
      );

      return runPipeline(client, corpus, {
        ...pipelineOptions,
        onProgress,
      });
    },
  );
}
