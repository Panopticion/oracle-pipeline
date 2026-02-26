---
layout: home
title: Panopticon AI — Compliance-Grade Corpus Ingestion Pipeline
titleTemplate: "%s"
description:
  "Open-source compliance-grade corpus ingestion pipeline. Validate, chunk, watermark, and embed
  regulatory documents into Postgres 17 + pgvector with full sovereignty attribution."
head:
  - - meta
    - property: og:title
      content: Panopticon AI — Know Where Every Vector Came From
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai
  - - meta
    - name: keywords
      content:
        RAG pipeline, compliance AI, vector database, pgvector, Postgres, GDPR, HIPAA, SOC 2,
        provenance tracking, data sovereignty, corpus ingestion, SIRE, identity-first retrieval,
        context collapse, deterministic enforcement
  - - link
    - rel: canonical
      href: https://panopticonlabs.ai

hero:
  name: Panopticon AI
  text: Know Where Every Vector Came From
  tagline:
    "For engineers who answer to auditors. Your vector pipeline has no provenance, no watermarks,
    and no idea which jurisdiction a chunk belongs to."
  image:
    src: /eye-icon.svg
    alt: Panopticon AI
  actions:
    - theme: brand
      text: Quickstart (~10 min)
      link: /quickstart
    - theme: alt
      text: Pipeline Guide
      link: /guide
    - theme: alt
      text: GitHub
      link: https://github.com/Panopticion/corpora-pipeline

features:
  - icon: 🛡️
    title: Attribution via CHECK Constraint
    details:
      "Every vector must trace to a registered authority and egress policy. Not a convention — a
      CHECK constraint. Un-attributed vectors can't exist."
  - icon: 🔏
    title: Provenance Watermarking
    details:
      "Every chunk gets a cryptographic signature. Export them anywhere — the watermark travels.
      Strip it? The hash won't match."
  - icon: 🎯
    title: S.I.R.E. Identity Enforcement
    details:
      "GDPR chunks stay GDPR. HIPAA chunks stay HIPAA. Deterministic gates, not probabilistic
      prayers. Semantic similarity is not jurisdictional authority."
    link: /sire
    linkText: How S.I.R.E. works →
  - icon: 📋
    title: Immutable Audit Envelopes
    details:
      "Every run logs who triggered it, which authority embedded, which policy governed, and what
      changed. Append-only. No edits. No deletions."
  - icon: 🗄️
    title: Any Postgres 17
    details:
      "Crunchy Bridge, Supabase, RDS, Cloud SQL, bare metal — anywhere pgvector runs. Talks
      PostgREST via Supabase SDK (or raw fetch). Your database. Your data."
  - icon: ⚖️
    title: Built for AI Regulation
    details: "Maps to NIST AI RMF, EU AI Act Articles 10–14, and DoD Responsible AI principles."
    link: /compliance
    linkText: View Compliance Mapping →
---

<div class="pipeline-flow">
  <span class="node">Corpus Markdown</span>
  <span class="arrow">→</span>
  <span class="node">Validate</span>
  <span class="arrow">→</span>
  <span class="node">Chunk</span>
  <span class="arrow">→</span>
  <span class="node highlight">Watermark</span>
  <span class="arrow">→</span>
  <span class="node highlight">Embed (OpenAI)</span>
  <span class="arrow">→</span>
  <span class="node">Postgres + pgvector</span>
  <span class="arrow">→</span>
  <span class="node">Your RAG Pipeline</span>
</div>

## Traditional RAG vs. Panopticon

Split text, call an embedding API, dump vectors, move on. That's fine for a chatbot. It's negligent
for regulated industries.

| Capability                    | Traditional Pipeline               | Panopticon                                               |
| ----------------------------- | ---------------------------------- | -------------------------------------------------------- |
| **Attribution**               | None. Vectors are anonymous blobs. | `CHECK` constraint — un-attributed vectors can't exist   |
| **Provenance**                | Trust the pipeline operator        | Cryptographic watermark on every chunk                   |
| **Tamper detection**          | None                               | Content hash + signature — strip or alter either, caught |
| **Audit trail**               | Application logs, maybe            | Immutable attestation records per embedding event        |
| **Jurisdictional boundaries** | Hope the LLM sorts it out          | S.I.R.E. deterministic enforcement gates                 |
| **Concurrent embedding**      | Pray for no double-writes          | Lease-based `FOR UPDATE SKIP LOCKED` with auto-recovery  |
| **Platform lock-in**          | Proprietary SDK                    | Any Postgres 17 + pgvector. PostgREST. Your infra.       |

## Context Collapse

Your RAG pipeline queries for "access control requirements under GDPR." Semantic search returns:

```
1. GDPR Art. 32 — Security of processing             similarity: 0.92
2. HIPAA § 164.312 — Technical safeguards             similarity: 0.89
3. SOC 2 CC6.1 — Logical access controls              similarity: 0.87
4. ISO 27001 A.9 — Access control policy               similarity: 0.85
```

All four are about access control. The embeddings are close. So the LLM gets all four and produces:

> "Under GDPR, covered entities must implement technical safeguards per §164.312..."

That mixes EU data protection law with US healthcare regulations. Reads authoritative. Legally
incoherent.

**Context Collapse.** Semantically close, jurisdictionally wrong. The LLM can't tell the difference.
Prompt engineering won't fix this — the evidence was contaminated before generation started.

### S.I.R.E. Fixes This at the Data Layer

S.I.R.E. — Subject, Included, Relevant, Excluded. Identity metadata in your corpus frontmatter,
stored on every chunk. After retrieval, before synthesis, the gate fires:

```
GDPR Art. 32          → ✓ subject: data_protection
HIPAA § 164.312       → ✗ PURGED — "covered entity" matches excluded term
SOC 2 CC6.1           → ✗ PURGED — crossed jurisdictional boundary
ISO 27001 A.9         → ✓ passes — mapped via relevant: [ISO-27001:A.8]
```

The LLM gets clean evidence. No bleed. No collapse.

[Learn how S.I.R.E. works →](/sire)

## What Is a Corpus?

A **corpus** is a Markdown document with regulatory or policy content. YAML frontmatter declares the
authority tier, frameworks, industries, and jurisdictional identity:

```markdown
---
corpus_id: gdpr-core-v1
title: GDPR Core Requirements
tier: tier_1
version: 1
content_type: prose
frameworks: [GDPR]
industries: [fintech, healthcare, saas]
fact_check:
  status: verified
  checked_at: "2026-01-10"
  checked_by: Compliance Team
sire:
  subject: data_protection
  included: [personal data, data subject, controller, processor, DPIA]
  excluded: [PHI, covered entity, business associate, HIPAA]
  relevant: [ISO-27001:A.8, SOC2:CC6.1, CCPA]
---

## Data Subject Rights

Organizations must respond to data subject requests within one calendar month...
```

Panopticon validates, chunks, watermarks, and embeds. It does not do retrieval or generation —
that's your job. You get a sovereignty-attributed vector store. Your retrieval layer queries it.

## Under the Hood

### 1. Structural Attribution (CHECK Constraint)

Every vector requires a registered **embedding authority** and **egress policy**. The database
enforces this with a `CHECK` constraint. No authority ID, no vector. The INSERT fails.

### 2. Provenance Watermarking

Every chunk gets a cryptographic watermark before storage:

```html
<!-- corpus-watermark:v1:gdpr-core-v1:3:a1b2c3d4e5f67890 -->
```

Verification is self-contained. No database needed:

```typescript
import { verifyChunkWatermark } from "@panopticon/corpus-pipeline";

const result = verifyChunkWatermark(chunk.content);
// { valid: true, payload: { corpusId: "gdpr-core-v1", sequence: 3, ... } }
```

Tamper with the content? Signature won't match. Strip the watermark? Content hash won't match.
Either way, caught.

On by default. Zero config. Set `WATERMARK_SECRET` for HMAC-SHA256.

### 3. Immutable Audit Envelopes

Every run logs an attestation record: who triggered it, which authority, which policy, what changed,
pass or fail. `corpus_embedding_events` records every completion and failure at the chunk level.
Append-only.

### 4. Lease-Based Concurrency

Claim/complete/fail with `FOR UPDATE SKIP LOCKED`. 600-second leases. Multiple workers, no
double-embeds. Worker dies? Lease expires, chunks re-enter the queue.

### 5. S.I.R.E. Identity-First Retrieval

Semantic search finds text _about_ similar things. S.I.R.E. enforces which chunks are _governed by_
the same authority. Four fields in corpus frontmatter:

```yaml
sire:
  subject: data_protection # Identity anchor
  included: [personal data, controller, processor] # Search enrichment
  excluded: [PHI, covered entity, HIPAA] # Hard boundary gate
  relevant: [ISO-27001:A.8, SOC2:CC6.1] # Topology expansion
```

**Only `excluded` enforces.** Everything else informs. Retrieval functions return S.I.R.E. metadata
with every chunk. Your application layer applies the gate. Add it to your riskiest corpora first.
Everything else works like before.

[Full S.I.R.E. documentation →](/sire)

## Ingestion Preview

```typescript
import { createClient } from "@supabase/supabase-js";
import { executePipelineRequest, type SovereigntyContext } from "@panopticon/corpus-pipeline";

const client = createClient(
  process.env.POSTGREST_URL!, // Any PostgREST endpoint
  process.env.PIPELINE_ADMIN_KEY!,
);

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

## Connect Your RAG Layer

Panopticon embeds and stores. Retrieval is your job. Three options:

### MCP Server (Claude Desktop / Claude Code)

The pipeline ships an MCP server. Two tools: `search_compliance_corpus` and
`verify_chunk_provenance`. Add it to Claude Desktop or Claude Code — your compliance corpus becomes
a tool Claude can call directly.

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

[MCP Server docs →](/mcp)

### SQL Functions (Any Language)

Two PostgREST-callable functions for your own retrieval layer:

- **`match_corpus_chunks`** — semantic search with metadata filtering (tier, frameworks, industries)
- **`match_corpus_chunks_hybrid`** — vector + full-text with Reciprocal Rank Fusion

Both return S.I.R.E. metadata with every result. Deactivated corpora excluded automatically.

[Pipeline Guide](/guide) for SQL examples. [API Reference](/api) for function signatures.

## Corpus Pipeline Web UI

Don't want to run the CLI? Use the **hosted web app** at
[pipeline.panopticonlabs.ai](https://panopticonlabs.ai):

1. **Sign in** — email/password or magic link
2. **Create a session** — group related compliance documents
3. **Upload & AI-parse** — drag-and-drop raw text; CFPO-prompted AI produces structured corpus
   Markdown with S.I.R.E. identity metadata
4. **Review & edit** — human-in-the-loop editing of every parsed document
5. **Generate crosswalk** — AI maps controls across all uploaded frameworks (GDPR ↔ HIPAA ↔ SOC 2…)
6. **Download bundle** — ZIP of all parsed documents, crosswalk, and auto-generated README

The web UI uses the same parse and crosswalk prompts as the CLI. Everything stays in your Supabase
project.

[Launch Corpus Pipeline →](https://panopticonlabs.ai)

## Try It Now (CLI)

No database. No API keys. No Docker.

```bash
git clone https://github.com/Panopticion/corpora-pipeline.git
cd corpora-pipeline
npm install

npx tsx src/cli.ts --action validate
```

```
[corpus-pipeline] action=validate corpus=all dryRun=false
  ✓ ai-usage-boundaries-v1
  ✓ crosswalk-gdpr-hipaa-soc2-v1
  ✓ gdpr-core-v1
  ✓ healthcare-compliance-v1
  ✓ identity-first-retrieval-v1
  ✓ soc2-controls-structured-v1
```

6 sample corpora: GDPR, HIPAA, SOC 2, AI governance, cross-framework mapping, and S.I.R.E. All
include identity metadata and fact-check attestations.

Want to contribute? See the [Product Roadmap](/roadmap) for phase-by-phase
`good_first_contributions` tasks.

**Ready for the full pipeline?** [Quickstart](/quickstart) — Postgres, PostgREST, sovereignty
seeding, and embedding in ~10 minutes.
