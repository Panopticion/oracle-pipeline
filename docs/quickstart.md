---
title: Quickstart
description:
  "Go from zero to your first embedded corpus chunk in about 10 minutes. Docker, Postgres 17,
  PostgREST, and pgvector."
head:
  - - meta
    - property: og:title
      content: Quickstart — Panopticon AI
  - - meta
    - property: og:description
      content:
        Go from zero to your first embedded corpus chunk in about 10 minutes with Docker, Postgres
        17, and PostgREST.
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai/quickstart
  - - meta
    - name: keywords
      content:
        quickstart, RAG pipeline setup, pgvector tutorial, PostgREST setup, compliance embedding,
        corpus ingestion
---

# Quickstart

This walkthrough takes you from an empty machine to a running pipeline with embedded corpus chunks
you can query. No shortcuts, no lies — every step is here.

**Time:** ~10 minutes (excluding Docker image pulls)

## Prerequisites

You need four things installed:

| Tool               | Why                                             | Install                                                     |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------- |
| **Docker**         | Runs Postgres + PostgREST locally               | [docker.com](https://docs.docker.com/get-docker/)           |
| **Node.js 20+**    | Runs the pipeline CLI                           | [nodejs.org](https://nodejs.org/)                           |
| **psql**           | Bootstraps the database schema                  | Comes with Postgres, or `brew install libpq` on macOS       |
| **OpenAI API key** | Generates embeddings (`text-embedding-3-large`) | [platform.openai.com](https://platform.openai.com/api-keys) |

::: warning OpenAI costs money The embedding step calls OpenAI's API. The 6 sample corpora cost
roughly $0.01–$0.02 to embed. You can run `validate` and `ingest` without an API key, but
`ingest_and_embed` requires one. :::

## 1. Clone and Install

```bash
git clone https://github.com/Panopticion/corpora-pipeline.git
cd corpora-pipeline
npm install
```

## 2. Start the Database

The included `docker-compose.yml` starts two containers:

- **pgvector** — Postgres 17 with the `vector` extension (port 5432)
- **PostgREST** — HTTP API over Postgres (port 3000)

```bash
docker compose up -d
```

Wait for both containers to be healthy:

```bash
docker compose ps
```

You should see both services with status `Up` (PostgREST waits for Postgres to pass its healthcheck
before starting).

## 3. Bootstrap the Schema

The schema is 11 idempotent SQL files. Run them in order against the local Postgres:

```bash
for f in sql/0*.sql sql/10_grants.sql; do
  psql "postgresql://postgres:postgres@localhost:5432/postgres" -f "$f"
done
```

This creates roles, extensions, tables, RLS policies, retrieval functions, and grants. Running it
twice is safe — every file uses `CREATE ... IF NOT EXISTS` or equivalent.

## 4. Generate a JWT

PostgREST authenticates via JWT. The docker-compose file uses a dev-only secret. Generate a
`pipeline_admin` token:

```bash
node -e "
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  role:'pipeline_admin',
  sub:'00000000-0000-0000-0000-000000000000',
  iss:'postgrest',
  iat: Math.floor(Date.now()/1000)
})).toString('base64url');
const crypto = require('crypto');
const sig = crypto.createHmac('sha256','super-secret-jwt-key-minimum-32-chars-long!!')
  .update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
"
```

Copy the output — you'll need it in step 6.

::: tip Pre-computed token for the default docker-compose secret If you haven't changed the JWT
secret, this token works:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoicGlwZWxpbmVfYWRtaW4iLCJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJpc3MiOiJwb3N0Z3Jlc3QiLCJpYXQiOjE3NzIwNDk4Njd9.loGoIeq9BAFH4_L2w6cmAGaWJx6VCLSELW_M8OcF1-0
```

:::

## 5. Seed Sovereignty Records

The pipeline requires two things before it will embed anything:

1. An **egress policy** — declares how embeddings leave your network
2. An **embedding authority** — declares who/what is performing the embedding

Create both:

```bash
psql "postgresql://postgres:postgres@localhost:5432/postgres" <<'SQL'
INSERT INTO egress_policies (name, scope, policy_hash, description, is_active)
VALUES ('vpc-local-dev-v1', 'vpc', 'sha256:dev-placeholder', 'Local development policy', true)
RETURNING id;

INSERT INTO embedding_authorities (name, environment, owner, is_active)
VALUES ('embedder-local-dev', 'vpc', 'quickstart', true)
RETURNING id;
SQL
```

Copy both UUIDs from the output.

## 6. Set Environment Variables

```bash
export POSTGREST_URL="http://localhost:3000"
export PIPELINE_ADMIN_KEY="<jwt-from-step-4>"
export OPENAI_API_KEY="sk-..."
export EMBEDDING_AUTHORITY_ID="<uuid-from-step-5>"
export EGRESS_POLICY_ID="<uuid-from-step-5>"
```

## 7. Run the Pipeline

The repo ships with 6 sample corpora in `corpora/samples/` (GDPR, HIPAA, SOC 2, AI governance, a
cross-framework mapping, and identity-first retrieval). Ingest and embed them:

```bash
npx tsx src/cli.ts --action ingest_and_embed
```

You should see output like:

```
Pipeline complete: { total: 6, valid: 6, ingested: 6, embedded: 6, errors: 0 }
```

If you want to see what happens without calling OpenAI, run `--action ingest` instead — it validates
and chunks but skips embedding.

## 8. Query Your First Chunk

Verify the chunks are in the database:

```bash
psql "postgresql://postgres:postgres@localhost:5432/postgres" \
  -c "SELECT corpus_id, section_title, left(content, 80) FROM corpus_chunks LIMIT 5;"
```

To do a semantic search, you'd call `match_corpus_chunks` via PostgREST RPC with a 512-dimensional
vector from `text-embedding-3-large`. See the [Pipeline Guide](/guide#connect-to-your-rag-pipeline)
for full retrieval examples in SQL, TypeScript, Python, and cURL.

## What Just Happened

You now have:

- **6 corpus documents** validated and stored in `corpus_documents`
- **~60 chunks** with 512d embeddings in `corpus_chunks`, each attributed to your embedding
  authority and egress policy
- **6 embedding event logs** in `corpus_embedding_events`
- **1 pipeline envelope** in `corpus_pipeline_run_attestations` recording who ran what and when

Every vector in the database traces back to an authority, a policy, and a pipeline run. That's the
sovereignty guarantee.

## Next Steps

| Goal                                   | Link                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Understand the full architecture       | [Pipeline Guide](/guide)                                                                          |
| Write your own corpus documents        | [Authoring Guide](https://github.com/Panopticion/corpora-pipeline/blob/main/corpora/AUTHORING.md) |
| Call retrieval functions from your app | [Connect to Your RAG Pipeline](/guide#connect-to-your-rag-pipeline)                               |
| See every type and function            | [API Reference](/api)                                                                             |

## Troubleshooting

**PostgREST returns 401 / JWT invalid:** Your JWT doesn't match the `PGRST_JWT_SECRET` in
`docker-compose.yml`. Regenerate it using the script in step 4.

**`relation "egress_policies" does not exist`:** The SQL bootstrap didn't complete. Re-run step 3 —
the files are idempotent.

**OpenAI 429 (rate limit):** The pipeline retries automatically with exponential backoff. If it
persists, you've hit your OpenAI account limit.

**`docker compose` not found:** Older Docker versions use `docker-compose` (hyphenated). Try
`docker-compose up -d`.
