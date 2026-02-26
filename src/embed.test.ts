import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, PendingChunk, SovereigntyContext } from "./types";
import { EMBEDDING_DIMENSIONS } from "./constants";

// ─── Mock fetch ──────────────────────────────────────────────────────────────

const fetchMock = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Test sovereignty context ────────────────────────────────────────────────

const testSovereignty: SovereigntyContext = {
  runId: "run-test-001",
  embeddingAuthorityId: "auth-test-001",
  egressPolicyId: "policy-test-001",
  triggeredBy: "test-suite",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeChunk(id: string, seq: number): PendingChunk {
  return {
    chunk_id: id,
    document_id: "doc-1",
    corpus_id: "test-corpus",
    section_title: `Section ${String(seq)}`,
    content: `Content for chunk ${id}`,
    language: "en",
    content_hash: `hash-${id}`,
  };
}

function makeVector(dims: number = EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length: dims }, (_, i) => i * 0.001);
}

function openAiResponse(count: number, dims?: number) {
  return {
    data: Array.from({ length: count }, () => ({
      embedding: makeVector(dims),
    })),
  };
}

function mockFetchOk(count: number) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(openAiResponse(count)), { status: 200 }),
  );
}

function mockFetchTransient(status: number) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { message: "rate limited" } }), {
      status,
    }),
  );
}

function mockFetchNetworkError(message: string) {
  fetchMock.mockRejectedValueOnce(new Error(message));
}

/**
 * Create a mock Supabase client that supports the sovereignty RPC flow:
 *   - .rpc("claim_corpus_chunks_for_embedding") returns claimed chunks
 *   - .rpc("complete_corpus_chunk_embedding") returns true
 *   - .rpc("fail_corpus_chunk_embedding") returns true
 *   - .from("corpus_documents").select().eq().single() returns corpus_id
 *   - .from("corpus_chunks").select() for count/dryRun queries
 */
function createMockClient(chunks: PendingChunk[]) {
  let claimCallCount = 0;
  const completeRpcFn = vi.fn().mockReturnValue({ data: true, error: null });
  const failRpcFn = vi.fn().mockReturnValue({ data: true, error: null });

  const rpcFn = vi.fn().mockImplementation((fnName: string) => {
    if (fnName === "claim_corpus_chunks_for_embedding") {
      // Return chunks on first call, empty on second (signals "done")
      claimCallCount++;
      if (claimCallCount === 1) {
        return { data: chunks, error: null };
      }
      return { data: [], error: null };
    }
    if (fnName === "complete_corpus_chunk_embedding") {
      return completeRpcFn();
    }
    if (fnName === "fail_corpus_chunk_embedding") {
      return failRpcFn();
    }
    return { data: null, error: null };
  });

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "corpus_documents") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue({
              data: { corpus_id: "test-corpus" },
              error: null,
            }),
          }),
        }),
      };
    }
    // corpus_chunks — for count queries and dryRun
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            data: null,
            error: null,
            count: chunks.length,
          }),
        }),
        in: vi.fn().mockReturnValue({
          data: null,
          error: null,
          count: chunks.length,
        }),
      }),
    };
  });

  return {
    client: { from, rpc: rpcFn } as unknown as SupabaseClient,
    from,
    rpcFn,
    completeRpcFn,
    failRpcFn,
    resetClaimCount: () => { claimCallCount = 0; },
  };
}

// ─── Import after mocks ──────────────────────────────────────────────────────

import { embedDocumentChunks } from "./embed";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("embedDocumentChunks", () => {
  it("returns zero counts when no pending chunks exist", async () => {
    const { client } = createMockClient([]);

    const result = await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
    });

    expect(result).toEqual({ embedded: 0, pending: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("embeds a single batch and reports counts", async () => {
    const chunks = [makeChunk("c1", 1), makeChunk("c2", 2)];
    const { client, completeRpcFn } = createMockClient(chunks);

    mockFetchOk(2);

    const result = await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
    });

    expect(result.embedded).toBe(2);
    expect(result.pending).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(completeRpcFn).toHaveBeenCalledTimes(2);
  });

  it("retries on transient 429 and succeeds", async () => {
    const chunks = [makeChunk("c1", 1)];
    const { client } = createMockClient(chunks);

    mockFetchTransient(429);
    mockFetchOk(1);

    const result = await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
    });

    expect(result.embedded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on transient 500 and succeeds", async () => {
    const chunks = [makeChunk("c1", 1)];
    const { client } = createMockClient(chunks);

    mockFetchTransient(500);
    mockFetchOk(1);

    const result = await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
    });

    expect(result.embedded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on network errors and succeeds", async () => {
    const chunks = [makeChunk("c1", 1)];
    const { client } = createMockClient(chunks);

    mockFetchNetworkError("fetch failed");
    mockFetchOk(1);

    const result = await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
    });

    expect(result.embedded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks batch as failed via RPC after exhausting retries", async () => {
    const chunks = [makeChunk("c1", 1)];
    const { client, failRpcFn } = createMockClient(chunks);

    // All 3 attempts fail with 429
    mockFetchTransient(429);
    mockFetchTransient(429);
    mockFetchTransient(429);

    const result = await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
    });

    expect(result.failed).toBe(1);
    expect(result.embedded).toBe(0);
    expect(failRpcFn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on non-transient 401 errors", async () => {
    const chunks = [makeChunk("c1", 1)];
    const { client } = createMockClient(chunks);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
        status: 401,
      }),
    );

    const result = await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-bad",
      sovereignty: testSovereignty,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
  });

  it("respects dryRun mode", async () => {
    const chunks = [makeChunk("c1", 1), makeChunk("c2", 2)];
    const { client } = createMockClient(chunks);

    const result = await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
      dryRun: true,
    });

    expect(result).toEqual({ embedded: 0, pending: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends correct model and dimensions to OpenAI", async () => {
    const chunks = [makeChunk("c1", 1)];
    const { client } = createMockClient(chunks);

    mockFetchOk(1);

    await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      model: string;
      dimensions: number;
    };

    expect(body.model).toBe("text-embedding-3-large");
    expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("uses section_title for embedding context", async () => {
    const chunk = makeChunk("c1", 1);
    const { client } = createMockClient([chunk]);

    mockFetchOk(1);

    await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { input: string[] };

    expect(body.input[0]).toContain("Section 1");
    expect(body.input[0]).toContain("Content for chunk c1");
  });

  it("respects maxWaitMs timeout", async () => {
    const chunks = [makeChunk("c1", 1), makeChunk("c2", 2), makeChunk("c3", 3)];
    const { client } = createMockClient(chunks);

    // maxWaitMs = -1 triggers timeout on very first check (elapsed >= 0 > -1)
    const result = await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
      maxWaitMs: -1,
    });

    expect(result.embedded).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls claim RPC with correct sovereignty params", async () => {
    const chunks = [makeChunk("c1", 1)];
    const { client, rpcFn } = createMockClient(chunks);

    mockFetchOk(1);

    await embedDocumentChunks(client, "doc-1", {
      openaiApiKey: "sk-test",
      sovereignty: testSovereignty,
    });

    const claimCall = rpcFn.mock.calls.find(
      (c: unknown[]) => c[0] === "claim_corpus_chunks_for_embedding",
    );
    expect(claimCall).toBeDefined();
    expect(claimCall![1]).toMatchObject({
      p_run_id: "run-test-001",
      p_embedding_authority_id: "auth-test-001",
    });
  });
});
