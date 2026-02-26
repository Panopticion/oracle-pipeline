---
title: MCP Server
description:
  "Connect Panopticon's compliance corpus to Claude Desktop and Claude Code via Model Context
  Protocol. Search attributed vectors and verify watermarks from any MCP client."
head:
  - - meta
    - property: og:title
      content: MCP Server — Panopticon AI
  - - meta
    - property: og:description
      content:
        Connect compliance corpus retrieval and watermark verification to Claude Desktop, Claude
        Code, and any MCP-compatible client.
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai/mcp
  - - meta
    - name: keywords
      content:
        MCP, Model Context Protocol, Claude Desktop, Claude Code, compliance search, watermark
        verification, corpus retrieval, AI tools
---

# MCP Server

The pipeline ships an [MCP](https://modelcontextprotocol.io/) server that exposes corpus search and
watermark verification as tools. Any MCP client — Claude Desktop, Claude Code, or your own — can use
them.

Two tools. No API server to deploy. Reads directly from your existing Postgres.

## Tools

### `search_compliance_corpus`

Semantic search over your sovereignty-attributed vector store. Takes a natural language query,
embeds it via OpenAI, and calls `match_corpus_chunks` against pgvector.

| Parameter     | Type     | Required | Description                                   |
| ------------- | -------- | -------- | --------------------------------------------- |
| `query`       | string   | Yes      | Natural language query                        |
| `frameworks`  | string[] | No       | Filter by framework (GDPR, HIPAA, SOC2)       |
| `tier`        | string   | No       | Authority level: `tier_1`, `tier_2`, `tier_3` |
| `match_count` | number   | No       | Max results (default: 10, max: 50)            |

Returns attributed chunks with:

- Corpus ID, section title, content
- Tier, content type, frameworks, industries
- Similarity score
- S.I.R.E. metadata (subject, included, excluded, relevant)

### `verify_chunk_provenance`

Verifies a chunk's provenance watermark. No database access required — verification is
self-contained.

| Parameter | Type   | Required | Description                               |
| --------- | ------ | -------- | ----------------------------------------- |
| `content` | string | Yes      | Chunk content including watermark comment |
| `secret`  | string | No       | HMAC secret for HMAC-SHA256 watermarks    |

Returns:

- `valid` — whether the watermark signature matches
- `payload` — corpus ID, chunk sequence, watermark version
- `reason` — why verification failed (if invalid)

## Setup

### 1. Environment Variables

```bash
POSTGREST_URL=https://your-project.supabase.co    # Required for search
PIPELINE_ADMIN_KEY=your-service-role-key           # Required for search
OPENAI_API_KEY=sk-...                              # Required for search
WATERMARK_SECRET=optional-hmac-secret              # Optional
```

The search tool needs all three. The verify tool works without any of them (offline verification).

### 2. Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "panopticon": {
      "command": "npx",
      "args": ["tsx", "/path/to/corpora-pipeline/src/mcp-server.ts"],
      "env": {
        "POSTGREST_URL": "https://your-project.supabase.co",
        "PIPELINE_ADMIN_KEY": "your-service-role-key",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

Restart Claude Desktop. Both tools appear in the tool picker.

### 3. Claude Code

Add to `.claude/settings.json` or run:

```bash
claude mcp add panopticon -- npx tsx /path/to/corpora-pipeline/src/mcp-server.ts
```

Set the environment variables in your shell before launching Claude Code.

### 4. Any MCP Client

The server uses stdio transport. Pipe JSON-RPC messages to stdin:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npx tsx src/mcp-server.ts
```

## How Search Works

The MCP server doesn't just pass your query to the database. It:

1. **Embeds your query** via OpenAI `text-embedding-3-large` (512d Matryoshka) — same model used for
   corpus embeddings
2. **Calls `match_corpus_chunks`** RPC with the vector + your filters
3. **Returns attributed results** — every chunk traces to a registered authority and egress policy

S.I.R.E. metadata is included in every result. Your application layer decides whether to enforce the
`excluded` gate — the MCP server returns the data, not the policy decision.

## Example

Ask Claude: _"What are the data subject rights under GDPR?"_

Claude calls `search_compliance_corpus` with `query: "data subject rights under GDPR"`. The tool
returns chunks from `gdpr-core-v1` with tier, frameworks, and S.I.R.E. metadata. HIPAA chunks that
are semantically similar but jurisdictionally wrong are still returned — with `sire_excluded` terms
that flag them as cross-boundary.

Then ask: _"Verify this chunk hasn't been tampered with"_ and paste any watermarked chunk content.
Claude calls `verify_chunk_provenance` and confirms integrity without touching the database.
