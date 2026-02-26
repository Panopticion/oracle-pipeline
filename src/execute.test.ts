import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Corpus } from "./types";
import type { PipelineResult, ValidationResult } from "./types";

const {
  runPipelineMock,
  validateCorpusMock,
  embedPendingChunksMock,
  registerPipelineRunMock,
} = vi.hoisted(() => ({
  runPipelineMock: vi.fn(),
  validateCorpusMock: vi.fn(),
  embedPendingChunksMock: vi.fn(),
  registerPipelineRunMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./pipeline", () => ({
  runPipeline: runPipelineMock,
}));

vi.mock("./validate", () => ({
  validateCorpus: validateCorpusMock,
}));

vi.mock("./embed", () => ({
  embedPendingChunks: embedPendingChunksMock,
  registerPipelineRun: registerPipelineRunMock,
}));

import {
  executePipelineRequest,
  CorpusPipelineExecutionError,
} from "./execute";
import type { SovereigntyContext } from "./types";

const testSovereignty: SovereigntyContext = {
  runId: "run-test-001",
  embeddingAuthorityId: "auth-test-001",
  egressPolicyId: "egress-test-001",
  triggeredBy: "test-suite",
};

function makeCorpus(id: string): Corpus {
  return {
    corpus_id: id,
    title: `Corpus ${id}`,
    tier: "tier_2",
    frameworks: ["iso-27001"],
    industries: ["software"],
    segments: ["general"],
    source_url: "https://example.com/corpus",
    source_publisher: "example",
    last_verified: "2026-02-24",
    version: "1.0.0",
    content_type: "prose",
    content: "## Overview\n\nHello",
    filePath: `/corpora/${id}.md`,
  };
}

function makeValidation(
  corpusId: string,
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
    corpus_id: corpusId,
    valid: true,
    errors: [],
    warnings: [],
    ...overrides,
  };
}

function makePipelineResult(
  corpusId: string,
  overrides: Partial<PipelineResult> = {},
): PipelineResult {
  return {
    corpus_id: corpusId,
    validation: makeValidation(corpusId),
    ingestion: {
      document_id: `${corpusId}-doc`,
      corpus_id: corpusId,
      action: "inserted",
      chunk_count: 3,
      validation: makeValidation(corpusId),
    },
    embedding: { embedded: 3, pending: 0 },
    ...overrides,
  };
}

describe("executePipelineRequest", () => {
  const client = {} as unknown;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails embed_pending without OPENAI key", async () => {
    await expect(
      executePipelineRequest({
        client: client as never,
        request: { action: "embed_pending" },
      }),
    ).rejects.toBeInstanceOf(CorpusPipelineExecutionError);
  });

  it("rejects embed_pending without sovereignty", async () => {
    await expect(
      executePipelineRequest({
        client: client as never,
        request: { action: "embed_pending" },
        openaiApiKey: "sk-test",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "missing_sovereignty",
    });
  });

  it("executes embed_pending and returns summary", async () => {
    embedPendingChunksMock.mockResolvedValueOnce({ embedded: 10, pending: 2 });

    const result = await executePipelineRequest({
      client: client as never,
      request: { action: "embed_pending" },
      openaiApiKey: "sk-test",
      embedPendingMaxWaitMs: 1234,
      sovereignty: testSovereignty,
    });

    expect(registerPipelineRunMock).toHaveBeenCalledWith(
      client,
      testSovereignty,
    );
    expect(embedPendingChunksMock).toHaveBeenCalledWith(client, {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
      maxWaitMs: 1234,
    });
    expect(result.summary.total).toBe(12);
    expect(result.summary.embedded).toBe(10);
  });

  it("executes validate and computes summary", async () => {
    const corpora = [makeCorpus("a"), makeCorpus("b")];
    validateCorpusMock
      .mockReturnValueOnce(makeValidation("a"))
      .mockReturnValueOnce(
        makeValidation("b", { valid: false, errors: ["bad"] }),
      );

    const result = await executePipelineRequest({
      client: client as never,
      request: { action: "validate" },
      loadCorpora: () => corpora,
    });

    expect(validateCorpusMock).toHaveBeenCalledTimes(2);
    expect(result.validations?.length).toBe(2);
    expect(result.summary.valid).toBe(1);
    expect(result.summary.errors).toBe(1);
  });

  it("executes ingest with skipEmbed when key is absent", async () => {
    const corpus = makeCorpus("a");
    runPipelineMock.mockResolvedValueOnce(makePipelineResult("a"));

    const result = await executePipelineRequest({
      client: client as never,
      request: { action: "ingest" },
      loadCorpora: () => [corpus],
      ingestedBy: "test-suite",
    });

    expect(runPipelineMock).toHaveBeenCalledWith(client, corpus, {
      requireFactCheck: true,
      ingestedBy: "test-suite",
      openaiApiKey: undefined,
      skipEmbed: true,
      maxEmbedWaitMs: 30000,
      sovereignty: undefined,
    });
    expect(result.summary.ingested).toBe(1);
  });

  it("executes ingest_and_embed when key is present", async () => {
    const corpus = makeCorpus("a");
    runPipelineMock.mockResolvedValueOnce(makePipelineResult("a"));

    await executePipelineRequest({
      client: client as never,
      request: { action: "ingest_and_embed" },
      loadCorpora: () => [corpus],
      openaiApiKey: "sk-live",
      sovereignty: testSovereignty,
    });

    expect(registerPipelineRunMock).toHaveBeenCalledWith(
      client,
      testSovereignty,
    );
    expect(runPipelineMock).toHaveBeenCalledWith(client, corpus, {
      requireFactCheck: true,
      ingestedBy: "corpus-pipeline",
      openaiApiKey: "sk-live",
      skipEmbed: false,
      maxEmbedWaitMs: 30000,
      sovereignty: testSovereignty,
    });
  });

  it("rejects rechunk without corpus_id", async () => {
    await expect(
      executePipelineRequest({
        client: client as never,
        request: { action: "rechunk" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "missing_corpus_id",
    });
  });

  it("executes rechunk with forceRechunk", async () => {
    const corpus = makeCorpus("a");
    runPipelineMock.mockResolvedValueOnce(makePipelineResult("a"));

    const result = await executePipelineRequest({
      client: client as never,
      request: { action: "rechunk", corpus_id: "a" },
      loadCorpora: () => [corpus],
    });

    expect(result.action).toBe("rechunk");
    expect(runPipelineMock).toHaveBeenCalledWith(client, corpus, {
      requireFactCheck: false,
      ingestedBy: "corpus-pipeline",
      forceRechunk: true,
      openaiApiKey: undefined,
      skipEmbed: true,
      maxEmbedWaitMs: 30000,
      sovereignty: undefined,
    });
  });

  it("threads sovereignty into rechunk when present", async () => {
    const corpus = makeCorpus("a");
    runPipelineMock.mockResolvedValueOnce(makePipelineResult("a"));

    await executePipelineRequest({
      client: client as never,
      request: { action: "rechunk", corpus_id: "a" },
      loadCorpora: () => [corpus],
      openaiApiKey: "sk-live",
      sovereignty: testSovereignty,
    });

    expect(registerPipelineRunMock).toHaveBeenCalledWith(
      client,
      testSovereignty,
    );
    expect(runPipelineMock).toHaveBeenCalledWith(client, corpus, {
      requireFactCheck: false,
      ingestedBy: "corpus-pipeline",
      forceRechunk: true,
      openaiApiKey: "sk-live",
      skipEmbed: false,
      maxEmbedWaitMs: 30000,
      sovereignty: testSovereignty,
    });
  });

  it("rejects ingest_content when content is missing", async () => {
    await expect(
      executePipelineRequest({
        client: client as never,
        request: { action: "ingest_content" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "missing_content",
    });
  });

  it("executes ingest_content with parsed inline corpus", async () => {
    const inlineMarkdown = `---
corpus_id: "inline-corpus"
title: "Inline Corpus"
tier: "tier_2"
frameworks: ["iso-27001"]
industries: ["software"]
segments: ["general"]
source_url: "https://example.com/corpus"
source_publisher: "example"
last_verified: "2026-02-24"
version: "1.0.0"
content_type: "prose"
---
## Overview

This is a test corpus with enough substantive content to pass the body validation check that requires at least fifty characters of body text after the frontmatter block.`;

    runPipelineMock.mockResolvedValueOnce(makePipelineResult("inline-corpus"));

    const result = await executePipelineRequest({
      client: client as never,
      request: { action: "ingest_content", content: inlineMarkdown },
    });

    expect(result.action).toBe("ingest_content");
    expect(result.results?.length).toBe(1);
    expect(runPipelineMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ corpus_id: "inline-corpus" }),
      {
        requireFactCheck: false,
        ingestedBy: "corpus-pipeline",
        openaiApiKey: undefined,
        skipEmbed: true,
        maxEmbedWaitMs: 30000,
        sovereignty: undefined,
      },
    );
  });

  it("returns domain errors for missing corpus IDs", async () => {
    await expect(
      executePipelineRequest({
        client: client as never,
        request: { action: "validate", corpus_id: "missing" },
        loadCorpora: () => [makeCorpus("other")],
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "corpus_not_found",
    });
  });
});
