#!/usr/bin/env node
/**
 * Panopticon AI — MCP Server
 *
 * Exposes corpus retrieval and watermark verification as Model Context Protocol
 * tools for Claude Desktop, Claude Code, and any MCP-compatible client.
 *
 * Tools:
 *   - search_compliance_corpus  — semantic search over sovereignty-attributed vectors
 *   - verify_chunk_provenance   — offline watermark verification (no DB required)
 *
 * Environment:
 *   POSTGREST_URL      — Supabase/PostgREST endpoint (required for search)
 *   PIPELINE_ADMIN_KEY — Service role key (required for search)
 *   OPENAI_API_KEY     — For query embedding (required for search)
 *   WATERMARK_SECRET   — Optional HMAC secret for watermark verification
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifyChunkWatermark } from "./watermark.js";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./constants.js";

// ─── Environment ────────────────────────────────────────────────────────────

const POSTGREST_URL = process.env.POSTGREST_URL ?? "";
const PIPELINE_ADMIN_KEY = process.env.PIPELINE_ADMIN_KEY ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const WATERMARK_SECRET = process.env.WATERMARK_SECRET;

// ─── Supabase client (lazy — only created if search tool is called) ─────────

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  if (!POSTGREST_URL || !PIPELINE_ADMIN_KEY) {
    throw new Error(
      "POSTGREST_URL and PIPELINE_ADMIN_KEY are required for search. " +
        "Set them in your MCP server environment.",
    );
  }
  _client = createClient(POSTGREST_URL, PIPELINE_ADMIN_KEY);
  return _client;
}

// ─── Query embedding ────────────────────────────────────────────────────────

async function embedQuery(query: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is required for search. " +
        "Set it in your MCP server environment.",
    );
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [query],
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  const body = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
    error?: { message?: string };
  };

  if (!res.ok || !body.data) {
    const msg = body.error?.message ?? `${String(res.status)} ${res.statusText}`;
    throw new Error(`OpenAI embedding failed: ${msg}`);
  }

  return body.data[0].embedding;
}

// ─── Result formatting ─────────────────────────────────────────────────────

interface ChunkResult {
  corpus_id: string;
  section_title: string;
  content: string;
  tier: string;
  content_type: string;
  frameworks: string[];
  industries: string[];
  similarity: number;
  sire_subject: string | null;
  sire_included: string[];
  sire_excluded: string[];
  sire_relevant: string[];
}

function formatChunkResult(chunk: ChunkResult, index: number): string {
  const lines = [
    `--- Result ${String(index + 1)} (similarity: ${chunk.similarity.toFixed(3)}) ---`,
    `Corpus: ${chunk.corpus_id}`,
    `Section: ${chunk.section_title}`,
    `Tier: ${chunk.tier} | Type: ${chunk.content_type}`,
  ];

  if (chunk.frameworks.length > 0) {
    lines.push(`Frameworks: ${chunk.frameworks.join(", ")}`);
  }
  if (chunk.industries.length > 0) {
    lines.push(`Industries: ${chunk.industries.join(", ")}`);
  }

  // S.I.R.E. metadata
  if (chunk.sire_subject) {
    lines.push(`S.I.R.E. Subject: ${chunk.sire_subject}`);
    if (chunk.sire_excluded.length > 0) {
      lines.push(`S.I.R.E. Excluded: ${chunk.sire_excluded.join(", ")}`);
    }
    if (chunk.sire_included.length > 0) {
      lines.push(`S.I.R.E. Included: ${chunk.sire_included.join(", ")}`);
    }
    if (chunk.sire_relevant.length > 0) {
      lines.push(`S.I.R.E. Relevant: ${chunk.sire_relevant.join(", ")}`);
    }
  }

  lines.push("", chunk.content);
  return lines.join("\n");
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "panopticon-corpus",
  version: "0.1.0",
});

// ── Tool 1: search_compliance_corpus ────────────────────────────────────────

server.tool(
  "search_compliance_corpus",
  "Search regulatory and compliance knowledge base. Returns attributed chunks with sovereignty metadata and S.I.R.E. identity fields.",
  {
    query: z.string().describe("Natural language query"),
    frameworks: z
      .array(z.string())
      .optional()
      .describe("Filter by framework (GDPR, HIPAA, SOC2)"),
    tier: z
      .enum(["tier_1", "tier_2", "tier_3"])
      .optional()
      .describe("Authority level filter"),
    match_count: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Max results to return"),
  },
  async ({ query, frameworks, tier, match_count }) => {
    try {
      const vector = await embedQuery(query);
      const client = getClient();

      const { data, error } = await client.rpc("match_corpus_chunks", {
        query_embedding: `[${vector.join(",")}]`,
        match_count: match_count,
        match_threshold: 0.5,
        filter_tier: tier ?? null,
        filter_frameworks: frameworks ?? null,
        filter_industries: null,
        filter_segments: null,
        filter_content_type: null,
        filter_corpus_ids: null,
        filter_organization_id: null,
      });

      if (error) {
        return {
          content: [
            { type: "text" as const, text: `Search failed: ${error.message}` },
          ],
          isError: true,
        };
      }

      const chunks = (data ?? []) as ChunkResult[];

      if (chunks.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No results found for: "${query}"`,
            },
          ],
        };
      }

      const formatted = chunks.map(formatChunkResult).join("\n\n");
      const header = `Found ${String(chunks.length)} result(s) for: "${query}"\n\n`;

      return {
        content: [{ type: "text" as const, text: header + formatted }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  },
);

// ── Tool 2: verify_chunk_provenance ─────────────────────────────────────────

server.tool(
  "verify_chunk_provenance",
  "Verify the provenance watermark on a corpus chunk. Confirms origin and detects tampering without database access.",
  {
    content: z
      .string()
      .describe("Chunk content including watermark comment"),
    secret: z
      .string()
      .optional()
      .describe("Optional HMAC secret for HMAC-SHA256 watermarks"),
  },
  async ({ content, secret }) => {
    try {
      const result = verifyChunkWatermark(content, secret ?? WATERMARK_SECRET);

      if (result.valid && result.payload) {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                "Watermark verification: VALID",
                "",
                `Corpus ID: ${result.payload.corpusId}`,
                `Chunk sequence: ${String(result.payload.sequence)}`,
                `Watermark version: ${result.payload.version}`,
                `Signature: ${result.payload.signature}`,
                "",
                "Content integrity confirmed. This chunk has not been tampered with.",
              ].join("\n"),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Watermark verification: FAILED",
              "",
              `Reason: ${result.reason ?? "Unknown"}`,
              "",
              result.payload
                ? `Claimed corpus: ${result.payload.corpusId}, sequence: ${String(result.payload.sequence)}`
                : "No watermark payload could be extracted.",
              "",
              "This chunk may have been tampered with or the watermark is missing/corrupt.",
            ].join("\n"),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  },
);

// ─── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
