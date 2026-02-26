---
title: "S.I.R.E. — Identity-First Retrieval"
description:
  "S.I.R.E. (Subject, Included, Relevant, Excluded) embeds deterministic identity metadata in corpus
  frontmatter for post-retrieval enforcement. Prevents Context Collapse in compliance RAG."
head:
  - - meta
    - property: og:title
      content: "S.I.R.E. Identity-First Retrieval — Panopticon AI"
  - - meta
    - property: og:description
      content:
        "Deterministic post-retrieval enforcement for compliance RAG. Prevent Context Collapse with
        S.I.R.E. identity metadata."
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai/sire
  - - meta
    - name: keywords
      content:
        "SIRE, identity-first retrieval, context collapse, boundary bleed, deterministic
        enforcement, compliance RAG, jurisdictional authority, post-retrieval gating"
---

# S.I.R.E. — Identity-First Retrieval

**Semantic meaning is not jurisdictional authority.** Embeddings can't deduce legal boundaries from
text. S.I.R.E. is deterministic identity metadata in corpus frontmatter that enables post-retrieval
enforcement.

## The Problem: Context Collapse

Query: "access control requirements under GDPR." Semantic search returns chunks from GDPR, HIPAA,
SOC 2, and ISO 27001 — because they're all _about_ access control. The embeddings are close. The LLM
gets a bucket of jurisdictionally orphaned chunks and stitches them into a fluent answer that mixes
EU data protection law with US healthcare regulations.

**Context Collapse**: semantically close, jurisdictionally wrong. The output reads authoritative.
It's legally incoherent.

**Why you can't train your way out of this:**

- Bi-encoder dense retrievers perform at or below random on negation-sensitive ranking
- Single-vector embeddings hit expressiveness ceilings — for any fixed dimension, there exist
  relevance sets they can't represent
- Dense similarity can't enforce Boolean-style exclusion

Semantic retrieval is good at discovery. It can't do enforcement.

## The Solution: Separate Discovery from Enforcement

S.I.R.E. adds four identity fields to every corpus document. The pipeline parses them from
frontmatter, stores them on both `corpus_documents` and `corpus_chunks` (denormalized, zero JOINs),
and returns them with every search result. Your application layer enforces the boundaries.

```yaml
sire:
  subject: data_protection
  included: [personal data, data subject, controller, processor, DPIA]
  excluded: [PHI, covered entity, business associate, HIPAA]
  relevant: [ISO-27001:A.8, SOC2:CC6.1, CCPA]
```

### The Four Pillars

| Pillar       | Role              | Enforces? | What it does                                                        |
| ------------ | ----------------- | --------- | ------------------------------------------------------------------- |
| **Subject**  | Identity anchor   | No        | Domain label (e.g. `data_protection`). Grouping and prompt headers. |
| **Included** | Search enrichment | No        | Keywords inside this domain. Strengthens discovery. Never vetoes.   |
| **Relevant** | Topology mapping  | No        | Cross-framework IDs for crosswalk expansion. Connects domains.      |
| **Excluded** | Hard boundary     | **Yes**   | Anti-keywords that disqualify chunks. The sole enforcement gate.    |

The asymmetry is deliberate:

- **Subject** anchors identity
- **Included** and **Relevant** inform discovery and topology
- **Excluded** is the only pillar that purges evidence

**Only `excluded` enforces. Everything else informs.**

## Adding S.I.R.E. to Your Corpus

Add a `sire:` block to your corpus frontmatter:

```markdown
---
corpus_id: gdpr-core-v1
title: GDPR Core Requirements
tier: tier_1
version: 1
frameworks: [GDPR]
industries: [fintech, healthcare, saas]
fact_check:
  status: verified
  checked_at: "2026-01-10"
  checked_by: Compliance Team
sire:
  subject: data_protection
  included: [personal data, data subject, controller, processor, DPIA, consent, lawful basis]
  excluded: [PHI, covered entity, business associate, HIPAA, ePHI]
  relevant: [ISO-27001:A.8, SOC2:CC6.1, CCPA]
---

## Data Subject Rights

...
```

### How to Choose Your Arrays

**`subject`** — Lowercase snake_case domain label. What jurisdiction does this corpus represent?

| Corpus Type             | Example Subject                 |
| ----------------------- | ------------------------------- |
| GDPR regulation         | `data_protection`               |
| HIPAA compliance        | `health_information_protection` |
| SOC 2 controls          | `trust_services_criteria`       |
| AI governance           | `ai_governance_boundaries`      |
| Cross-framework mapping | `cross_framework_mapping`       |

**`included`** — Keywords inside this domain. If a chunk has these terms, it's likely governed by
this framework.

```yaml
# GDPR corpus
included: [personal data, data subject, controller, processor, DPIA, consent]

# HIPAA corpus
included: [PHI, ePHI, covered entity, business associate, minimum necessary]
```

**`excluded`** — Keywords from a _different_ domain. If a chunk has these terms, it crossed a
boundary.

```yaml
# GDPR corpus excludes HIPAA terms
excluded: [PHI, covered entity, business associate, HIPAA, ePHI]

# HIPAA corpus excludes GDPR terms
excluded: [data subject, controller, processor, GDPR, DPIA, lawful basis]
```

**`relevant`** — Cross-framework references for topology expansion. Framework IDs or version
aliases.

```yaml
relevant: [ISO-27001:A.8, SOC2:CC6.1, CCPA]
```

### When `excluded` Should Be Empty

Some corpora span frameworks on purpose:

- **Crosswalks** map equivalent concepts between GDPR, HIPAA, and SOC 2 — they ARE the bridge. Empty
  `excluded` is correct.
- **Governance documents** (AI usage boundaries, risk frameworks) span frameworks by design.
- **Meta-documents** describing S.I.R.E. itself have no boundary to enforce.

```yaml
# Crosswalk corpus — empty excluded is correct
sire:
  subject: cross_framework_mapping
  included: [crosswalk, access control, encryption, breach notification]
  excluded: []
  relevant: [GDPR, HIPAA, SOC2]
```

## Database Storage

Separate columns (not JSONB) on both `corpus_documents` and `corpus_chunks`:

```sql
-- On both tables:
sire_subject    TEXT,                        -- Domain label
sire_included   TEXT[] NOT NULL DEFAULT '{}', -- Search enrichment keywords
sire_excluded   TEXT[] NOT NULL DEFAULT '{}', -- Deterministic enforcement gate
sire_relevant   TEXT[] NOT NULL DEFAULT '{}', -- Cross-framework topology
```

GIN indexes on `sire_excluded` and `sire_included` for fast containment queries.

Denormalized into chunks — same pattern as `frameworks`, `industries`, `segments`. No JOINs at
retrieval time.

## Retrieval

Both retrieval functions return S.I.R.E. columns with every result:

```sql
SELECT
  id, corpus_id, content, similarity,
  sire_subject, sire_included, sire_excluded, sire_relevant
FROM match_corpus_chunks_hybrid(
  query_embedding := <vector>,
  query_text      := 'data breach notification requirements',
  match_count     := 20
);
```

The retrieval functions don't filter on S.I.R.E. They return everything. Enforcement happens in your
application layer, after retrieval, before synthesis.

## Enforcement Pattern

**Bottom-Up Discovery, Top-Down Enforcement.**

### 1. Bottom-Up Discovery

Query hits hybrid search. Postgres returns candidate chunks ranked by semantic + lexical similarity.
These are probabilistic votes — they suggest which identities are relevant.

### 2. Identity Collapse

Group returned chunks by `sire_subject`. Rank subjects by mean similarity. The winning subjects are
what your query is about.

### 3. Top-Down Enforcement

For each winning subject, load its `sire_excluded` array. Walk the candidate pool. Disqualify any
chunk whose content contains an excluded term. Deterministic, not probabilistic.

```typescript
function enforceExclusions(
  chunks: RetrievedChunk[],
  winningSubject: string,
  excluded: string[],
): RetrievedChunk[] {
  if (excluded.length === 0) return chunks; // Empty = no gating

  return chunks.filter((chunk) => {
    const lower = chunk.content.toLowerCase();
    return !excluded.some((term) => new RegExp(`\\b${escapeRegex(term)}\\b`, "iu").test(lower));
  });
}
```

### 4. Synthesis

The LLM gets only chunks that survived the gate, organized by identity. No jurisdictional bleed.

## Graceful Degradation

S.I.R.E. is built for progressive deployment, not big-bang migration:

| Scenario                                         | Behavior                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Corpus has no `sire:` block                      | Bypasses gating. Standard RAG.                                                  |
| `excluded` is empty                              | No enforcement. Chunk passes all gates.                                         |
| All chunks purged                                | Flag `SUSPICIOUS_PURGE` — excluded array may be over-tuned.                     |
| Mixed corpora (some with S.I.R.E., some without) | Gated and ungated coexist. Enforcement only hits chunks with identity metadata. |

Add S.I.R.E. to your highest-liability corpora first. Leave everything else ungated. The system
degrades gracefully at every stage.

## TypeScript Type

```typescript
export interface CorpusSire {
  /** Domain label (e.g. "data_protection"). */
  subject: string;
  /** Keywords inside this domain. Informs search, never vetoes. */
  included: string[];
  /** Anti-keywords that disqualify chunks at runtime. The sole enforcement gate. */
  excluded: string[];
  /** Cross-framework IDs for topological expansion. */
  relevant: string[];
}
```

Available as `CorpusSire` from `@panopticon/corpus-pipeline`.

## Sample Corpora

All 6 sample corpora ship with S.I.R.E. metadata:

| Corpus                         | Subject                             | Key Exclusions                 |
| ------------------------------ | ----------------------------------- | ------------------------------ |
| `gdpr-core-v1`                 | `data_protection`                   | PHI, covered entity, HIPAA     |
| `healthcare-compliance-v1`     | `health_information_protection`     | data subject, controller, GDPR |
| `soc2-controls-structured-v1`  | `trust_services_criteria`           | data subject, PHI, GDPR, HIPAA |
| `ai-usage-boundaries-v1`       | `ai_governance_boundaries`          | _(empty — spans frameworks)_   |
| `crosswalk-gdpr-hipaa-soc2-v1` | `cross_framework_mapping`           | _(empty — IS the bridge)_      |
| `identity-first-retrieval-v1`  | `identity_enforcement_architecture` | _(empty — meta-document)_      |

Run `npx tsx src/cli.ts --action validate` to see them all pass.

## Further Reading

- [Corpus Authoring Guide](https://github.com/Panopticion/corpora-pipeline/blob/main/corpora/AUTHORING.md)
  — Full frontmatter reference including S.I.R.E. fields
- [API Reference](/api) — `CorpusSire` type and pipeline functions
- [Pipeline Guide](/guide) — End-to-end architecture walkthrough
