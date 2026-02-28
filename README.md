# Panopticon AI

## Repository map

| Repository                        | Purpose                                                               |
| --------------------------------- | --------------------------------------------------------------------- |
| `Panopticion/corpus-web`          | Web app for upload, review, chunk/watermark, crosswalk, and export UX |
| `Panopticion/corpus-pipeline-cli` | Public CLI/runtime, worker, MCP server, and sample corpora            |

**Compliance-grade corpus ingestion pipeline.** Validate, chunk, watermark, and embed regulatory
documents into Postgres 17 + pgvector with full sovereignty attribution.

Every vector traces to a registered authority and egress policy. Not a convention — a `CHECK`
constraint. Un-attributed vectors can't exist.

[Documentation](https://panopticonlabs.ai) · [Quickstart](https://panopticonlabs.ai/quickstart) ·
[GitHub](https://github.com/Panopticion/corpus-web)

## Why This Exists

Split text, call an embedding API, dump vectors. Fine for a chatbot. Negligent for regulated
industries.

Your RAG pipeline has no provenance, no watermarks, and no idea which jurisdiction a chunk belongs
to. An auditor asks "where did this vector come from?" and you don't have an answer.

Panopticon gives you one.

## What It Does

```
Corpus Markdown → Validate → Chunk → Watermark → Embed (OpenAI) → Postgres + pgvector
```

- **Attribution** — `CHECK` constraint on every vector. No registered authority = INSERT fails.
- **Provenance watermarking** — cryptographic signature on every chunk. Tamper with content or strip
  the watermark — either way, caught.
- **S.I.R.E. identity gates** — GDPR chunks stay GDPR. HIPAA chunks stay HIPAA. Deterministic
  enforcement, not probabilistic prayers.
- **Immutable audit trail** — every run logs who triggered it, which authority embedded, which
  policy governed. Append-only.
- **Lease-based concurrency** — `FOR UPDATE SKIP LOCKED`. Multiple workers, no double-embeds.
- **Any Postgres 17** — Crunchy Bridge, Supabase, RDS, Cloud SQL, bare metal. Your database.

## Quick Start

No database. No API keys. No Docker.

```bash
git clone https://github.com/Panopticion/corpus-web.git
cd corpus-web
npm install

npx tsx src/cli.ts --action validate
```

6 sample corpora ship with the repo: GDPR, HIPAA, SOC 2, AI governance, cross-framework mapping, and
S.I.R.E. identity-first retrieval.

For the full pipeline (Postgres, PostgREST, sovereignty seeding, embedding):
[Quickstart →](https://panopticonlabs.ai/quickstart)

## MCP Server

The pipeline ships an MCP server for Claude Desktop and Claude Code. Two tools:

- **`search_compliance_corpus`** — semantic search over sovereignty-attributed vectors
- **`verify_chunk_provenance`** — offline watermark verification (no DB required)

```json
{
  "mcpServers": {
    "panopticon": {
      "command": "npx",
      "args": ["tsx", "src/mcp-server.ts"],
      "env": {
        "POSTGREST_URL": "https://your-project.supabase.co",
        "PIPELINE_ADMIN_KEY": "your-service-role-key",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

[MCP Server docs →](https://panopticonlabs.ai/mcp)

## Retrieval Functions

Two PostgREST-callable SQL functions for your own retrieval layer:

- **`match_corpus_chunks`** — semantic search with metadata filtering (tier, frameworks, industries)
- **`match_corpus_chunks_hybrid`** — vector + full-text with Reciprocal Rank Fusion (k=20)

Both return S.I.R.E. metadata with every result. Deactivated corpora excluded automatically.

## Ingestion API

```typescript
import { createClient } from "@supabase/supabase-js";
import { executePipelineRequest, type SovereigntyContext } from "@panopticon/corpus-pipeline";

const client = createClient(process.env.POSTGREST_URL!, process.env.PIPELINE_ADMIN_KEY!);

const sovereignty: SovereigntyContext = {
  runId: crypto.randomUUID(),
  embeddingAuthorityId: process.env.EMBEDDING_AUTHORITY_ID!,
  egressPolicyId: process.env.EGRESS_POLICY_ID!,
  triggeredBy: "cli",
};

const response = await executePipelineRequest({
  client,
  request: { action: "ingest_and_embed" },
  openaiApiKey: process.env.OPENAI_API_KEY,
  sovereignty,
});

console.log(response.summary);
// { total: 12, valid: 12, ingested: 8, embedded: 8, errors: 0 }
```

## Environment Variables

| Variable                 | Required | Description                                              |
| ------------------------ | -------- | -------------------------------------------------------- |
| `POSTGREST_URL`          | Yes      | PostgREST URL (`http://localhost:3000` for local Docker) |
| `PIPELINE_ADMIN_KEY`     | Yes      | JWT with `role: pipeline_admin`                          |
| `OPENAI_API_KEY`         | Yes      | OpenAI API key for `text-embedding-3-large`              |
| `EMBEDDING_AUTHORITY_ID` | Yes      | UUID of the embedding authority                          |
| `EGRESS_POLICY_ID`       | Yes      | UUID of the egress policy                                |
| `ORGANIZATION_ID`        | No       | Multi-tenant org scope (NULL = platform)                 |
| `WATERMARK_SECRET`       | No       | HMAC secret for watermark verification                   |

## Database Schema

Run SQL files in order (`00_` through `10_`). Every file is idempotent.

```bash
for f in sql/0*.sql sql/10_grants.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

Three roles, no Supabase dependency:

| Role             | Purpose                          |
| ---------------- | -------------------------------- |
| `pipeline_admin` | Full access — CLI, server routes |
| `pipeline_user`  | JWT-authenticated, RLS-scoped    |
| `pipeline_anon`  | Unauthenticated read-only        |

## Testing

```bash
npm test          # All tests (101 specs)
npm run typecheck # TypeScript strict mode
npm run lint      # ESLint
```

## Compliance Mapping

Panopticon maps to NIST AI RMF, EU AI Act Articles 10–14, and DoD Responsible AI principles.
[View compliance mapping →](https://panopticonlabs.ai/compliance)

## Roadmap

See [docs/panopticon-plan.yaml](docs/panopticon-plan.yaml) for the full roadmap. Each phase includes
`good_first_contributions` tasks for new contributors.

- **Phase 0** — Auth (sign-up, sign-in, JWT, tenant isolation)
- **Phase 1** — HTTP API (Hono on Node/Bun)
- **Phase 2** — Document intake (PDF, DOCX, TXT, HTML → Markdown)
- **Phase 3** — Claude integration (MCP server) ✓
- **Phase 4** — Ops (rate limiting, usage metering, observability)

## License

MIT
