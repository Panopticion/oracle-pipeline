---
title: Pipeline Guide
description:
  "Complete guide to installing, configuring, and running the Panopticon AI corpus ingestion
  pipeline. Sovereignty, watermarking, chunking, retrieval."
head:
  - - meta
    - property: og:title
      content: Pipeline Guide — Panopticon AI
  - - meta
    - property: og:description
      content:
        Complete guide to sovereignty attribution, provenance watermarking, heading-aware chunking,
        and hybrid retrieval.
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai/guide
  - - meta
    - name: keywords
      content:
        corpus pipeline guide, sovereignty attribution, provenance watermarking, semantic chunking,
        hybrid search, PostgREST, pgvector, embedding pipeline
---

# Pipeline Guide

Panopticon AI is a **validate → ingest → chunk → embed** pipeline for corpus documents — structured
Markdown files containing regulatory, compliance, and policy knowledge. It produces a
sovereignty-attributed vector store in Postgres that your RAG pipeline queries for retrieval.

**What it does:** Validates corpus frontmatter, splits content on heading boundaries, generates
embeddings via OpenAI, and stores attributed vectors in pgvector.

**What it does NOT do:** Retrieval or generation. Those are your RAG pipeline's responsibility.
Panopticon provides the retrieval SQL functions (`match_corpus_chunks`,
`match_corpus_chunks_hybrid`) — you call them from your app.

## Installation

```bash
git clone https://github.com/Panopticion/corpora-pipeline.git
cd corpora-pipeline
npm install
```

## Architecture

```
executePipelineRequest()
  │
  ├─ registerPipelineRun(client, sovereignty)
  │     └─ INSERT → corpus_pipeline_run_attestations
  │
  ├─ runPipeline(client, corpus, { sovereignty })
  │     ├─ validateCorpus()        ← frontmatter + content checks
  │     ├─ ingestCorpus()          ← upsert doc + chunk on headings
  │     └─ embedDocumentChunks()   ← OpenAI via sovereignty layer
  │           │
  │           ├─ claimChunks()     ← FOR UPDATE SKIP LOCKED
  │           ├─ embedBatch()      ← text-embedding-3-large (512d)
  │           ├─ completeChunk()   ← SET embedding + log event
  │           └─ failChunk()       ← SET status='failed' + log event
  │
  └─ recordPipelineEnvelope()      ← audit envelope
```

## Database Setup

The schema is split into 11 idempotent SQL files. Run them in order:

```bash
# Against any Postgres 17 + pgvector
for f in sql/0*.sql sql/10_grants.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

| File                 | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `00_roles.sql`       | `pipeline_admin`, `pipeline_user`, `pipeline_anon` roles |
| `01_extensions.sql`  | pgcrypto, pgvector, uuid_generate_v7()                   |
| `02_console.sql`     | Orgs, members, projects, ontologies, policies + RLS      |
| `03_sovereignty.sql` | Egress policies (immutable), embedding authorities       |
| `04_builder.sql`     | Corpus domains, sources, state axes, versions            |
| `05_content.sql`     | corpus_documents, corpus_chunks, corpus_indexes          |
| `06_rls.sql`         | Content store row-level security                         |
| `07_retrieval.sql`   | match, hybrid search, upsert, claim/complete             |
| `08_views.sql`       | Summary views                                            |
| `09_envelopes.sql`   | Pipeline envelopes, embedding event log                  |
| `10_grants.sql`      | Function grants                                          |

### Roles (no cloud dependency)

| Role             | Replaces        | Purpose                             |
| ---------------- | --------------- | ----------------------------------- |
| `pipeline_admin` | `service_role`  | Full access — CLI and server routes |
| `pipeline_user`  | `authenticated` | JWT-authenticated end-user (RLS)    |
| `pipeline_anon`  | `anon`          | Unauthenticated read-only           |

## PostgREST Setup

The pipeline client speaks PostgREST. Point it at your database:

```bash
docker run --rm -p 3000:3000 \
  -e PGRST_DB_URI="$DATABASE_URL" \
  -e PGRST_DB_SCHEMAS="public" \
  -e PGRST_DB_ANON_ROLE="pipeline_anon" \
  -e PGRST_JWT_SECRET="<your-jwt-secret>" \
  postgrest/postgrest:v12.2.3
```

Or use the included Docker Compose for local dev:

```bash
docker compose up -d
```

This starts pgvector (Postgres 17) + PostgREST with the correct role mappings.

## Environment Variables

| Variable                 | Required | Description                                                     |
| ------------------------ | -------- | --------------------------------------------------------------- |
| `POSTGREST_URL`          | Yes      | PostgREST URL (`http://localhost:3000` for local)               |
| `PIPELINE_ADMIN_KEY`     | Yes      | JWT with `role: pipeline_admin`                                 |
| `OPENAI_API_KEY`         | Yes      | OpenAI API key for `text-embedding-3-large`                     |
| `EMBEDDING_AUTHORITY_ID` | Yes      | UUID of the embedding authority                                 |
| `EGRESS_POLICY_ID`       | Yes      | UUID of the egress policy                                       |
| `ORGANIZATION_ID`        | No       | Multi-tenant org scope (NULL = platform)                        |
| `WATERMARK_ENABLED`      | No       | Set to `false` to disable chunk watermarking (default: enabled) |
| `WATERMARK_SECRET`       | No       | HMAC secret for watermark signatures (uses SHA-256 if not set)  |

## Seed Sovereignty Records

Before running the pipeline, create the required sovereignty records:

```sql
-- Create an egress policy
INSERT INTO egress_policies (name, scope, policy_hash, description, is_active)
VALUES ('vpc-no-public-egress-v1', 'vpc', 'sha256:placeholder', 'Dev policy', true)
RETURNING id;  -- → EGRESS_POLICY_ID

-- Create an embedding authority
INSERT INTO embedding_authorities (name, environment, owner, is_active)
VALUES ('embedder-dev-01', 'vpc', 'dev-team', true)
RETURNING id;  -- → EMBEDDING_AUTHORITY_ID
```

## Running the Pipeline

### CLI

```bash
# Full pipeline: validate → ingest → embed
npx tsx src/cli.ts --action ingest_and_embed

# Validate only (no writes)
npx tsx src/cli.ts --action validate

# Embed pending chunks (skip ingest)
npx tsx src/cli.ts --action embed_pending
```

### Programmatic

```typescript
import { createClient } from "@supabase/supabase-js";
import { executePipelineRequest, type SovereigntyContext } from "@panopticon/corpus-pipeline";

const client = createClient(process.env.POSTGREST_URL!, process.env.PIPELINE_ADMIN_KEY!);

const sovereignty: SovereigntyContext = {
  runId: crypto.randomUUID(),
  embeddingAuthorityId: process.env.EMBEDDING_AUTHORITY_ID!,
  egressPolicyId: process.env.EGRESS_POLICY_ID!,
  triggeredBy: "api",
};

const response = await executePipelineRequest({
  client,
  request: { action: "ingest_and_embed" },
  openaiApiKey: process.env.OPENAI_API_KEY,
  sovereignty,
});

console.log(response.summary);
```

## Pipeline Actions

| Action             | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| `validate`         | Parse and validate all corpus frontmatter + content        |
| `ingest`           | Validate + upsert documents + chunk (no embedding)         |
| `ingest_and_embed` | Full pipeline: validate → ingest → embed                   |
| `embed_pending`    | Embed chunks that are pending (skip ingest step)           |
| `rechunk`          | Force-rechunk all documents even if content hasn't changed |
| `ingest_content`   | Ingest raw markdown content (frontmatter + body string)    |

## Sovereignty Flow

Every embedding operation passes through the sovereignty layer:

1. **`registerPipelineRun()`** — attests the run with authority + egress policy
2. **`claimChunks()`** — `FOR UPDATE SKIP LOCKED` lease (600s default)
3. **`embedBatch()`** — OpenAI `text-embedding-3-large` (512 dimensions)
4. **`completeChunkEmbedding()`** — writes vector + logs to `corpus_embedding_events`
5. **`failChunkEmbedding()`** — marks chunk as failed + logs the error

The database **structurally prevents** un-attributed embeddings — `corpus_chunks` has a `CHECK`
constraint requiring `embedding_authority_id` when `embedding IS NOT NULL`.

## Provenance Watermarking

Every chunk is stamped with a cryptographic watermark before it's stored in the database and
embedded. This means the chunk **content itself** carries provenance — not just the database
metadata.

### How It Works

After chunking and before database insertion, the pipeline appends an invisible HTML comment to each
chunk:

```html
<!-- corpus-watermark:v1:gdpr-core-v1:3:a1b2c3d4e5f67890 -->
```

The signature is the first 16 hex characters of `SHA-256(corpus_id|sequence|content_hash)`. The
`content_hash` is computed on the **original** un-watermarked content, so it serves as a
tamper-detection anchor.

### Verification

Given any chunk content (even exported from the database), you can verify its provenance:

```typescript
import { verifyChunkWatermark, stripWatermark } from "@panopticon/corpus-pipeline";

// Verify a chunk from your database or any external source
const result = verifyChunkWatermark(chunk.content);

if (result.valid) {
  console.log(`Verified: corpus=${result.payload.corpusId}, seq=${result.payload.sequence}`);
} else {
  console.log(`Tampered or missing watermark: ${result.reason}`);
}

// Recover original content (without watermark)
const original = stripWatermark(chunk.content);
```

### Tamper Detection

The watermark creates two layers of tamper detection:

1. **Content modified?** → The watermark signature won't match when recomputed from the modified
   content
2. **Watermark stripped?** → `SHA256(content)` won't match the `content_hash` column in the database

### Configuration

| Setting                   | Default  | Description                                  |
| ------------------------- | -------- | -------------------------------------------- |
| `WATERMARK_ENABLED`       | `true`   | Set to `false` to disable                    |
| `WATERMARK_SECRET`        | _(none)_ | HMAC secret for forgery-resistant signatures |
| `options.watermark`       | `true`   | Programmatic override per ingestion call     |
| `options.watermarkSecret` | _(none)_ | Programmatic HMAC secret                     |

**Default mode (SHA-256):** Anyone can verify the watermark. Anyone could also forge one. Suitable
for internal audit trails.

**HMAC mode:** Only holders of the secret can generate valid signatures. Set `WATERMARK_SECRET` for
production deployments where forgery resistance matters.

## Chunking Algorithm

Corpus documents are split using a heading-aware algorithm:

1. Split on `##` (H2) headings → chunk boundaries
2. Split on `###` (H3) headings → sub-chunk boundaries
3. Merge chunks < **75 words** into predecessor

| Constant               | Value                    | Effect                |
| ---------------------- | ------------------------ | --------------------- |
| `MIN_CHUNK_WORDS`      | 75                       | Merge threshold       |
| `EMBEDDING_MODEL`      | `text-embedding-3-large` | OpenAI model          |
| `EMBEDDING_DIMENSIONS` | 512                      | Matryoshka truncation |
| `CLAIM_BATCH_SIZE`     | 50                       | Chunks per claim RPC  |
| `LEASE_SECONDS`        | 600                      | Lease before re-claim |
| `EMBED_BATCH_SIZE`     | 20                       | Texts per OpenAI call |

## Corpus Document Format

Corpora are Markdown files with YAML frontmatter. See the
[Authoring Guide](https://github.com/Panopticion/corpora-pipeline/blob/main/corpora/AUTHORING.md)
for the full specification.

```markdown
---
corpus_id: gdpr-core-v1
title: GDPR Core Requirements
tier: tier_1
version: 1
content_type: prose
frameworks: [GDPR]
industries: [fintech, healthcare]
---

## Data Subject Rights

Organizations must respond to data subject requests within one calendar month...
```

### Content Types

| Type         | Use Case                                     |
| ------------ | -------------------------------------------- |
| `prose`      | Long-form regulatory/guidance text (default) |
| `boundary`   | Allowed/prohibited behavior rules            |
| `structured` | JSON payloads embedded in fenced code blocks |

### Tiers

| Tier     | Authority Level    | Examples                   |
| -------- | ------------------ | -------------------------- |
| `tier_1` | Regulatory mandate | GDPR, HIPAA, EU AI Act     |
| `tier_2` | Industry standard  | SOC 2, ISO 27001, NIST CSF |
| `tier_3` | Best practice      | CIS Benchmarks, OWASP      |

## Testing

```bash
npm test
```

Tests use vitest and mock the PostgREST client (via `@supabase/supabase-js`). No database required
for unit tests.

Current test coverage includes:

- Core pipeline modules (`execute`, `embed`, `concurrency`, `watermark`, content helpers)
- CLI behavior (`src/cli.test.ts`) for help output, invalid actions, and validate-action smoke test
- Corpus validator rules (`src/validate.test.ts`) for fact-check gate and substantive-change
  detection

Run targeted suites:

```bash
npm run test:cli
npm run test:validator
```

## Connect to Your RAG Pipeline

Panopticon handles ingestion. Once your corpora are embedded, you need a **retrieval layer** and a
**generation layer** — that's your RAG pipeline. Here's how to connect them.

### What Panopticon Produces

After running `ingest_and_embed`, your Postgres database contains:

- **`corpus_documents`** — one row per corpus (metadata, version, content hash, active/inactive)
- **`corpus_chunks`** — one row per chunk (content, 512d embedding vector, heading path, section
  title, tier, frameworks, industries)
- **`corpus_embedding_events`** — immutable log of every embedding operation

### Retrieval: Two SQL Functions

The schema provides two retrieval functions callable via PostgREST RPC or direct SQL:

#### `match_corpus_chunks` — Pure Semantic Search

```sql
SELECT * FROM match_corpus_chunks(
  query_embedding        := <your_512d_vector>,  -- text-embedding-3-large, 512d
  match_count            := 10,
  match_threshold        := 0.7,
  filter_tier            := 'tier_1',            -- optional
  filter_frameworks      := ARRAY['GDPR'],       -- optional
  filter_industries      := ARRAY['fintech'],    -- optional
  filter_content_type    := 'prose',             -- optional
  filter_corpus_ids      := NULL,                -- optional: specific corpora
  filter_organization_id := NULL                 -- optional: tenant scope
);
-- Returns: id, document_id, corpus_id, section_title, content, tier,
--          content_type, frameworks, industries, segments, similarity
```

#### `match_corpus_chunks_hybrid` — Vector + Full-Text (RRF)

```sql
SELECT * FROM match_corpus_chunks_hybrid(
  query_embedding   := <your_512d_vector>,
  query_text        := 'data breach notification timeline',
  match_count       := 10,
  semantic_weight   := 0.7,  -- 70% vector, 30% full-text
  filter_tier       := 'tier_1'
);
-- Returns: id, content, similarity, text_rank, combined_score
-- Uses Reciprocal Rank Fusion (k=20) over top-200 candidates
```

### Calling from Your App (PostgREST RPC)

Since the database is fronted by PostgREST, call these from **any language** via HTTP:

**JavaScript / TypeScript:**

```typescript
import { createClient } from "@supabase/supabase-js";

const client = createClient(POSTGREST_URL, JWT);

// 1. Embed the user's question (same model + dimensions as ingestion)
const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "text-embedding-3-large",
    input: userQuestion,
    dimensions: 512,
  }),
});
const { data } = await embeddingRes.json();
const queryEmbedding = data[0].embedding;

// 2. Retrieve relevant chunks
const { data: chunks } = await client.rpc("match_corpus_chunks_hybrid", {
  query_embedding: queryEmbedding,
  query_text: userQuestion,
  match_count: 10,
  semantic_weight: 0.7,
  filter_frameworks: ["GDPR"],
});

// 3. Feed into your LLM (generation is your responsibility)
const context = chunks.map((c) => c.content).join("\n\n");
const prompt = `Answer based on these regulatory sources:\n\n${context}\n\nQuestion: ${userQuestion}`;
// → send to OpenAI, Anthropic, Ollama, etc.
// For production prompt design, see the Prompt Engineering (CFPO) guide: /prompt-engineering
```

**Python:**

```python
import httpx, openai

# 1. Embed the question
resp = openai.embeddings.create(
    model="text-embedding-3-large",
    input=user_question,
    dimensions=512,
)
query_embedding = resp.data[0].embedding

# 2. Retrieve chunks via PostgREST
chunks = httpx.post(
    f"{POSTGREST_URL}/rpc/match_corpus_chunks_hybrid",
    headers={"Authorization": f"Bearer {jwt}"},
    json={
        "query_embedding": query_embedding,
        "query_text": user_question,
        "match_count": 10,
        "semantic_weight": 0.7,
    },
).json()

# 3. Build context for your LLM
context = "\n\n".join(c["content"] for c in chunks)
```

**cURL:**

```bash
curl -X POST "$POSTGREST_URL/rpc/match_corpus_chunks" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "query_embedding": [0.012, -0.034, ...],
    "match_count": 10,
    "filter_tier": "tier_1"
  }'
```

### Important: Use the Same Embedding Model

Your query embedding **must** use the same model and dimensions as ingestion:

| Parameter  | Value                         |
| ---------- | ----------------------------- |
| Model      | `text-embedding-3-large`      |
| Dimensions | `512` (Matryoshka truncation) |

Mismatched models or dimensions will produce meaningless similarity scores.

### Architecture Summary

```
┌─────────────────────────────────────────────┐
│              Panopticon AI                  │
│  Corpus.md → validate → chunk → embed       │
│  (sovereignty attributed, envelope logged)  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
         ┌─────────────────┐
         │  Postgres 17    │
         │  + pgvector     │
         │                 │
         │  corpus_chunks  │◄── Your app calls:
         │  (512d vectors) │    match_corpus_chunks()
         │                 │    match_corpus_chunks_hybrid()
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │  Your RAG App   │
         │                 │
         │  Retrieve →     │
         │  Augment →      │
         │  Generate       │
         └─────────────────┘
```
