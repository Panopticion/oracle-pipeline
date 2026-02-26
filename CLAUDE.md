# Panopticon AI — Corpus Pipeline

## Supabase

- **Project ref:** `exjuzuhgsmrdbwaoxbio`
- **URL:** `https://exjuzuhgsmrdbwaoxbio.supabase.co`
- **Region:** Check dashboard for region (needed for psql pooler connection)
- **Credentials:** `.env.local` (gitignored, never committed)

### Role Mapping

| Supabase Role   | Pipeline Role    | Purpose                       |
| --------------- | ---------------- | ----------------------------- |
| `service_role`  | `pipeline_admin` | Full access, bypasses RLS     |
| `authenticated` | `pipeline_user`  | JWT-scoped, org-gated via RLS |
| `anon`          | `pipeline_anon`  | Public read-only              |

### Environment Variables (.env.local)

```bash
POSTGREST_URL=https://exjuzuhgsmrdbwaoxbio.supabase.co
PIPELINE_ADMIN_KEY=<service_role_key>
OPENAI_API_KEY=sk-...
EMBEDDING_AUTHORITY_ID=<from seed step>
EGRESS_POLICY_ID=<from seed step>
SUPABASE_DB_PASSWORD=<database password>
```

### Runbook: Database Operations

**Connect via psql:**

```bash
source .env.local
psql "postgresql://postgres.exjuzuhgsmrdbwaoxbio:${SUPABASE_DB_PASSWORD}@aws-0-us-east-2.pooler.supabase.com:6543/postgres"
```

**Run bootstrap migration (first time only):**

```bash
source .env.local
psql "postgresql://postgres.exjuzuhgsmrdbwaoxbio:${SUPABASE_DB_PASSWORD}@aws-0-us-east-2.pooler.supabase.com:6543/postgres" -f supabase/00_bootstrap.sql
```

**Run individual SQL files (for updates):**

```bash
source .env.local
psql "postgresql://postgres.exjuzuhgsmrdbwaoxbio:${SUPABASE_DB_PASSWORD}@aws-0-us-east-2.pooler.supabase.com:6543/postgres" -f sql/07_retrieval.sql
```

**Get sovereignty IDs after seeding:**

```bash
source .env.local
psql "postgresql://postgres.exjuzuhgsmrdbwaoxbio:${SUPABASE_DB_PASSWORD}@aws-0-us-east-2.pooler.supabase.com:6543/postgres" \
  -c "SELECT id, name FROM egress_policies; SELECT id, name FROM embedding_authorities;"
```

### Runbook: Pipeline Operations

**Validate corpora (no DB needed):**

```bash
npx tsx src/cli.ts --action validate
```

**Ingest + embed against Supabase:**

```bash
source .env.local
npx tsx src/cli.ts --action ingest_and_embed
```

**Test MCP server:**

```bash
source .env.local
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npx tsx src/mcp-server.ts
```

## Development

- **Build:** `npm run build`
- **Test:** `npm test` (101 specs, all unit tests, no DB needed)
- **Typecheck:** `npm run typecheck`
- **Lint:** `npm run lint`
- **Prettier:** `npm run prettier:check` (Markdown + YAML)
- **Docs dev:** `npm run docs:dev`
- **Docs build:** `npm run docs:build`

## Git Conventions

- Single orphan commit on `main`, authored by `Panopticon AI <engineering@panopticonlabs.ai>`
- Force-push after every change session
- All CI checks must pass before push: prettier, lint, typecheck, tests, docs build

### Husky Hooks

- **Pre-commit** (`.husky/pre-commit`): identity guard (blocks personal identities) + `lint-staged`
  (ESLint autofix on `src/**/*.ts`, Prettier on `*.{md,yml,yaml}`)
- **Pre-push** (`.husky/pre-push`): full validation — prettier:check, lint, typecheck, test

## Architecture

- `src/` — Pipeline TypeScript (validate, ingest, chunk, watermark, embed, MCP server)
- `sql/` — 11 idempotent SQL files (vanilla Postgres, no Supabase dependency)
- `supabase/` — Supabase-specific migration (wraps sql/ + role grants + auth trigger)
- `docs/` — VitePress documentation site (deployed to Vercel)
- `corpora/` — Sample corpus documents (GDPR, HIPAA, SOC 2, etc.)
