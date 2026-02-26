# Corpus Pipeline Manifest

Standalone corpus ingest → chunk → embed pipeline with VPC sovereignty. Runs on any Postgres 17 +
pgvector — no Supabase platform dependency.

All types are inlined — no external dependencies beyond `@supabase/supabase-js` (PostgREST client).

## What's Included

### Pipeline Source (`src/`)

| File                  | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `constants.ts`        | Embedding config, retry tuning, claim/lease params            |
| `types.ts`            | All pipeline types incl. SovereigntyContext, PendingChunk     |
| `content-helpers.ts`  | Corpus parsing, chunking, hashing                             |
| `validate.ts`         | Corpus frontmatter validation                                 |
| `ingest.ts`           | Document ingestion + chunking                                 |
| `embed.ts`            | OpenAI embedding via sovereignty RPC (claim/complete/fail)    |
| `pipeline.ts`         | validate → ingest → embed orchestration                       |
| `execute.ts`          | Batch execution with registerPipelineRun() gate               |
| `envelope.ts`         | Audit envelope recording with sovereignty attribution         |
| `concurrency.ts`      | Concurrency limiter                                           |
| `cli.ts`              | CLI entry point (`npx tsx src/cli.ts --action embed_pending`) |
| `index.ts`            | Barrel export                                                 |
| `execute.test.ts`     | Tests                                                         |
| `concurrency.test.ts` | Tests                                                         |
| `embed.test.ts`       | Tests                                                         |

### Database Schema (`sql/`)

Run files in numeric order (`00_` through `10_`). All files are idempotent.

| File                 | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `00_roles.sql`       | Roles (pipeline_admin/user/anon) + minimal `users` table            |
| `01_extensions.sql`  | pgcrypto, pgvector, uuid_generate_v7(), update_updated_at_column()  |
| `02_console.sql`     | Organizations, members, projects, ontologies, policies, audit + RLS |
| `03_sovereignty.sql` | Egress policies (immutable), embedding authorities                  |
| `04_builder.sql`     | Corpus domains, sources, state axes, versions + RLS + helpers       |
| `05_content.sql`     | corpus_documents, corpus_chunks, corpus_indexes + triggers          |
| `06_rls.sql`         | Content store row-level security                                    |
| `07_retrieval.sql`   | match, hybrid search, upsert, claim/complete/fail, start_pipeline   |
| `08_views.sql`       | Summary views for admin console                                     |
| `09_envelopes.sql`   | Pipeline envelopes, embedding event log + RLS                       |
| `10_grants.sql`      | Function grants (REVOKE FROM PUBLIC, GRANT TO pipeline_admin)       |

### Corpus Samples & Authoring Guide (`corpora/`)

| File                                      | Type       | Description                                             |
| ----------------------------------------- | ---------- | ------------------------------------------------------- |
| `AUTHORING.md`                            | Guide      | How to write corpora optimized for chunking & embedding |
| `samples/gdpr-core-v1.md`                 | Framework  | Tier 1 prose corpus — GDPR core requirements            |
| `samples/healthcare-compliance-v1.md`     | Industry   | Tier 2 prose corpus — HIPAA / HITECH / FDA 21 CFR 11    |
| `samples/ai-usage-boundaries-v1.md`       | Boundary   | Tier 3 boundary corpus — allowed / prohibited AI usage  |
| `samples/soc2-controls-structured-v1.md`  | Structured | Tier 2 structured corpus — SOC 2 controls as JSON       |
| `samples/crosswalk-gdpr-hipaa-soc2-v1.md` | Crosswalk  | Tier 2 prose crosswalk — GDPR ↔ HIPAA ↔ SOC 2           |

### Config & DX

- `package.json` — standalone package manifest (deps, scripts, type: module)
- `tsconfig.json` — standalone TypeScript config (no extends)
- `.env.example` — template for required env vars
- `docker-compose.yml` — local dev stack (pgvector + PostgREST)

## Dependencies

- `@supabase/supabase-js` — PostgREST + RPC client (works with any PostgREST)

### Dev Dependencies

- `@types/node` — Node.js type definitions
- `tsx` — TypeScript runner for CLI
- `typescript` — Type-checking and build
- `vitest` — Test runner

## Environment Keys Needed

- `POSTGREST_URL` — PostgREST URL
- `PIPELINE_ADMIN_KEY` — JWT with `role: pipeline_admin`
- `OPENAI_API_KEY`
- `EMBEDDING_AUTHORITY_ID` — sovereignty: which authority is embedding
- `EGRESS_POLICY_ID` — sovereignty: which egress policy governs the call
- `ORGANIZATION_ID` (optional) — multi-tenant org scope

## Roles (no Supabase dependency)

| Role             | Replaces (Supabase) | Purpose                           |
| ---------------- | ------------------- | --------------------------------- |
| `pipeline_admin` | `service_role`      | Full access (server routes / CLI) |
| `pipeline_user`  | `authenticated`     | JWT-authenticated end-user        |
| `pipeline_anon`  | `anon`              | Unauthenticated / public read     |

All RLS policies use `current_setting('request.jwt.claim.sub')` and
`current_setting('request.jwt.claim.role')` instead of Supabase's `auth.uid()` / `auth.role()`.
Works with any PostgREST-compatible JWT.
