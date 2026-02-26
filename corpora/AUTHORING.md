# Corpus Authoring Guide

How to write corpus documents that chunk and embed well.

---

## Format Overview

Every corpus is a **Markdown file** with YAML frontmatter:

```markdown
---
corpus_id: my-corpus-slug
title: Human-Readable Title
tier: tier_1
version: 1
content_type: prose
frameworks: [GDPR, SOC2]
industries: [fintech, healthcare]
segments: [enterprise]
source_url: https://example.com/source
source_publisher: Example Authority
last_verified: 2026-01-15
language: en
fact_check:
  status: verified
  checked_at: "2026-01-15"
  checked_by: Compliance Team
sire:
  subject: data_protection
  included: [personal data, consent, controller]
  excluded: [PHI, covered entity, HIPAA]
  relevant: [ISO-27001:A.8, SOC2:CC6.1]
---

## First Section

Body content here...
```

## Frontmatter Reference

### Required Fields

| Field       | Type     | Description                                                          |
| ----------- | -------- | -------------------------------------------------------------------- |
| `corpus_id` | `string` | URL-safe slug, unique per corpus (e.g. `gdpr-core-v1`)               |
| `title`     | `string` | Human-readable title shown in admin UI                               |
| `tier`      | `enum`   | `tier_1` (regulatory), `tier_2` (industry), `tier_3` (best practice) |
| `version`   | `number` | Integer version — bump on substantive edits                          |

### Optional Fields

| Field              | Type       | Description                                             |
| ------------------ | ---------- | ------------------------------------------------------- |
| `frameworks`       | `string[]` | Regulatory/compliance frameworks (e.g. `[GDPR, HIPAA]`) |
| `industries`       | `string[]` | Target industries (e.g. `[healthcare, fintech]`)        |
| `segments`         | `string[]` | Customer segments (e.g. `[enterprise, smb]`)            |
| `source_url`       | `string`   | Canonical URL of the authoritative source               |
| `source_publisher` | `string`   | Publisher or issuing body                               |
| `last_verified`    | `string`   | ISO date when content was last verified against source  |
| `content_type`     | `enum`     | `prose` (default), `boundary`, `structured`             |
| `language`         | `string`   | ISO 639-1 code (default: `en`)                          |
| `fact_check`       | `object`   | Fact-check attestation block (see below)                |
| `sire`             | `object`   | S.I.R.E. identity-first retrieval metadata (see below)  |

### Nested Block: `fact_check`

The `fact_check` block attests that the corpus content has been verified against its authoritative
source:

```yaml
fact_check:
  status: verified
  checked_at: "2026-01-15"
  checked_by: Compliance Team
```

| Field        | Type     | Description                                  |
| ------------ | -------- | -------------------------------------------- |
| `status`     | `string` | Must be `"verified"` for substantive changes |
| `checked_at` | `string` | ISO date of verification (YYYY-MM-DD)        |
| `checked_by` | `string` | Person or team who verified the content      |
| `notes`      | `string` | Optional notes about the verification        |

When `requireFactCheck` is enabled (default for production), the pipeline blocks ingestion of new or
changed corpora that lack a verified `fact_check`.

### Nested Block: `sire` (Identity-First Retrieval)

S.I.R.E. (Subject, Included, Relevant, Excluded) embeds deterministic identity metadata for
post-retrieval enforcement. This prevents Context Collapse — the blending of semantically similar
but jurisdictionally distinct content.

```yaml
sire:
  subject: data_protection
  included: [personal data, data subject, controller, processor, DPIA]
  excluded: [PHI, covered entity, business associate, HIPAA]
  relevant: [ISO-27001:A.8, SOC2:CC6.1, CCPA]
```

| Field      | Type       | Description                                                |
| ---------- | ---------- | ---------------------------------------------------------- |
| `subject`  | `string`   | Domain label — taxonomic anchor (e.g. `data_protection`)   |
| `included` | `string[]` | Editorial keywords for search enrichment (never vetoes)    |
| `excluded` | `string[]` | Anti-keywords for deterministic gating (the hard boundary) |
| `relevant` | `string[]` | Cross-framework IDs for topology expansion                 |

**Key rules:**

- S.I.R.E. is **optional** — corpora without it bypass gating entirely
- `excluded` is the only enforcement gate — everything else informs discovery
- Empty `excluded: []` is valid (crosswalks and governance docs that span frameworks)
- `subject` should be a lowercase snake_case domain label
- `included` keywords should be terms that belong _inside_ this domain
- `excluded` keywords should be terms that would indicate a _different_ domain's content
- `relevant` holds cross-framework references for topological expansion

**Example: GDPR corpus excludes HIPAA terms**

```yaml
sire:
  subject: data_protection
  included: [personal data, data subject, controller, processor]
  excluded: [PHI, covered entity, business associate, HIPAA]
  relevant: [ISO-27001:A.8, SOC2:CC6.1]
```

**Example: Crosswalk corpus has empty exclusions**

```yaml
sire:
  subject: cross_framework_mapping
  included: [crosswalk, access control, encryption, breach notification]
  excluded: []
  relevant: [GDPR, HIPAA, SOC2]
```

### Array Syntax

Frontmatter arrays use **bracket notation**:

```yaml
frameworks: [GDPR, CCPA, SOC2]
industries: [fintech, healthcare]
```

The parser reads these as string arrays. No quotes needed around values.

---

## Content Types

### `prose` (default)

Standard long-form regulatory or guidance text. Best for frameworks, industry standards, and general
compliance guidance. The chunker splits on headings and produces semantically coherent chunks.

### `boundary`

Lists of **allowed / prohibited** behaviors. Use when the corpus defines hard lines rather than
explaining concepts. The chunker treats each section as an independent rule boundary.

### `structured`

Embeds JSON payloads, lookup tables, or machine-readable mappings inside fenced code blocks. The
chunker preserves code fences intact within their parent heading section.

---

## Tier System

| Tier     | Meaning               | Examples                     |
| -------- | --------------------- | ---------------------------- |
| `tier_1` | Regulatory mandate    | GDPR, HIPAA, SOX, PCI-DSS    |
| `tier_2` | Industry standard     | SOC 2, ISO 27001, NIST CSF   |
| `tier_3` | Best practice / guide | CIS Benchmarks, OWASP Top 10 |

Tier affects retrieval ranking — `tier_1` documents are weighted higher in hybrid search. Choose the
tier that matches the **authority level** of the source material.

---

## Chunking: How It Works

The pipeline splits corpus bodies using a **heading-based algorithm**:

1. **Split on `##` (H2)** — each H2 heading becomes a chunk boundary.
2. **Split on `###` (H3)** — within each H2 section, H3 headings create sub-chunks.
3. **Merge small chunks** — any chunk under **75 words** is merged into its predecessor.
4. **Sub-split large chunks** — any chunk over **500 words** is split at sentence boundaries (`. `)
   to stay within the embedding window.

| Parameter         | Value | Effect                              |
| ----------------- | ----- | ----------------------------------- |
| `MIN_CHUNK_WORDS` | 75    | Merge threshold (below = merge up)  |
| `MAX_CHUNK_WORDS` | 500   | Split threshold (above = sub-split) |

### What the Chunker Produces

Each chunk becomes an `CorpusChunkRaw`:

```typescript
{
  sequence: 1,              // 0-indexed position
  section_title: "Data Subject Rights",
  heading_level: 2,         // 2 = H2, 3 = H3
  content: "## Data Subject Rights\n\nOrganizations must...",
  content_hash: "sha256:abc123...",
  token_count: 187,
  heading_path: ["Data Subject Rights"]
}
```

The `heading_path` array tracks nesting: a chunk under `## Encryption` → `### At Rest` would have
`heading_path: ["Encryption", "At Rest"]`.

---

## Writing for Optimal Chunking

### 1. Use H2 for Major Topics

Each `##` heading creates a chunk boundary. Put one **coherent topic** per H2 section. The section
title becomes the chunk's `section_title` in the vector store, which is used for hybrid search.

```markdown
## Data Retention

Organizations must define and enforce data retention policies...

## Access Control

Implement role-based access control (RBAC) with least-privilege...
```

**Anti-pattern:** Don't put unrelated concepts under one H2 — they'll be embedded together and
dilute retrieval precision.

### 2. Use H3 for Sub-Topics (When Sections Are Long)

If an H2 section exceeds ~400 words, break it into H3 sub-sections. This gives the chunker natural
split points before the 500-word hard limit:

```markdown
## Encryption

### At Rest

All data at rest must be encrypted using AES-256...

### In Transit

All data in transit must use TLS 1.2 or higher...
```

### 3. Target 100–400 Words per Section

The sweet spot for embedding quality:

- **Under 75 words**: Gets merged into the previous chunk (may lose context).
- **75–400 words**: Ideal — one coherent topic, embeds cleanly.
- **400–500 words**: Fine, but close to the split threshold.
- **Over 500 words**: Will be sub-split at sentence boundaries, which may break mid-thought.

### 4. Front-Load Key Terms

Embedding models weight early tokens more heavily. Put the most important concept in the **first
sentence** after each heading:

```markdown
## Breach Notification

Organizations must notify affected individuals within 72 hours of discovering a personal data
breach. This requirement applies to...
```

### 5. Keep Headings Descriptive

The heading text is included in the chunk content and becomes the `section_title`. Make headings
specific enough to be useful in search:

| Good                           | Bad            |
| ------------------------------ | -------------- |
| `## Data Breach Notification`  | `## Section 3` |
| `### Encryption at Rest`       | `### Details`  |
| `## RBAC Implementation Guide` | `## Access`    |

### 6. Avoid Orphan Headings

A heading with fewer than ~20 words of body text will produce a tiny chunk that gets merged upward.
Either add substance or fold it into the parent:

```markdown
<!-- BAD: orphan heading -->

## Overview

See below.

## Detailed Requirements

...

<!-- GOOD: remove the orphan -->

## Detailed Requirements

...
```

### 7. Use Fenced Code Blocks for Structured Data

When embedding JSON, YAML, or tables, wrap them in fenced code blocks. The chunker keeps code fences
intact with their surrounding text:

````markdown
## API Rate Limits

```json
{
  "default": { "requests_per_minute": 60, "burst": 10 },
  "premium": { "requests_per_minute": 600, "burst": 100 }
}
```
````

### 8. One Corpus per Regulatory Domain

Don't combine GDPR and HIPAA in one corpus. Each corpus should cover a **single framework, standard,
or domain**. Cross-references between frameworks belong in a **crosswalk corpus** (content_type:
`prose` or `structured`).

---

## Writing Boundary Corpora

Boundary corpora use `content_type: boundary` and define hard rules. Structure them with clear
**allowed / prohibited** sections:

```markdown
---
content_type: boundary
---

## Allowed Behaviors

### Data can be stored in approved regions

US-East, EU-West, and AP-Southeast are approved storage regions...

## Prohibited Behaviors

### No plaintext PII in logs

Application logs must never contain unmasked PII...
```

Each allowed/prohibited item should be its own H3 section so it chunks independently.

---

## Writing Structured Corpora

Structured corpora use `content_type: structured` and embed machine-readable payloads. The prose
around the code block provides context for the embedding:

````markdown
---
content_type: structured
---

## Control Mapping

The following JSON maps SOC 2 controls to ISO 27001 Annex A controls:

```json
[
  { "soc2": "CC6.1", "iso27001": "A.9.1.1", "domain": "Access Control" },
  { "soc2": "CC6.2", "iso27001": "A.9.2.1", "domain": "User Registration" }
]
```
````

Always include a prose description above or below the code block — the embedding model needs natural
language context, not just raw JSON.

---

## Writing Crosswalk Corpora

A crosswalk maps equivalent concepts between two or more frameworks. Use H2 for each domain and
include the mapping in a structured format:

```markdown
## Access Control

GDPR Article 32 requires "appropriate technical measures" for access control. HIPAA §164.312(a)(1)
requires a "unique user identification" mechanism. SOC 2 CC6.1 requires "logical access security"
over information assets.

These three requirements are functionally equivalent for RBAC implementation.
```

---

## Versioning

- Bump `version` when the **substance** changes (new rules, updated thresholds, removed sections).
- **Don't** bump version for typo fixes or formatting-only changes. The pipeline compares
  `content_hash` (SHA-256 of body) and will skip unchanged documents automatically.
- The `hasSubstantiveChanges()` validator checks: `content_hash`, `version`, `title`, `tier`,
  `content_type`, `frameworks`, `industries`, `segments`.

---

## Content Hashing

The pipeline hashes the **body only** (everything after the closing `---` frontmatter delimiter)
using SHA-256. Frontmatter changes alone don't change the content hash, but the validator also
checks frontmatter fields for substantive differences.

---

## Checklist

Before submitting an corpus:

- [ ] `corpus_id` is a unique URL-safe slug
- [ ] `tier` matches the authority level of the source
- [ ] `version` is bumped if content changed substantively
- [ ] Every H2 section covers one coherent topic
- [ ] Sections are 100–400 words (sweet spot for embedding)
- [ ] Headings are descriptive (not "Section 1", "Details")
- [ ] No orphan headings (< 20 words of body)
- [ ] `frameworks` and `industries` arrays are accurate
- [ ] `source_url` points to the authoritative source
- [ ] `last_verified` date is current
- [ ] `fact_check` block present with `status: verified` and valid date
- [ ] `sire` block present with appropriate subject/included/excluded/relevant
- [ ] If `content_type: structured`, every code block has surrounding prose
- [ ] If `content_type: boundary`, rules are split into individual H3 items
