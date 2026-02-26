---
corpus_id: identity-first-retrieval-v1
title: Identity-First Retrieval — S.I.R.E. Architecture
tier: tier_3
version: 1
content_type: boundary
frameworks: [NIST-AI-RMF, EU-AI-Act]
industries: [saas, fintech, healthcare]
segments: [enterprise, smb]
source_url: https://www.ontic.ai/docs/sire
source_publisher: Ontic
last_verified: 2026-02-24
language: en
fact_check:
  status: verified
  checked_at: "2026-02-24"
  checked_by: Ontic Architecture Team
sire:
  subject: identity_enforcement_architecture
  included:
    [identity, enforcement, deterministic, boundary, context collapse, jurisdiction, S.I.R.E.]
  excluded: []
  relevant: [NIST-AI-RMF, EU-AI-Act:Art.14, ISO-42001]
---

## Identity Is Not NLP

Semantic meaning is not jurisdictional authority. No amount of Natural Language Processing —
including dense vector embeddings, BM25 lexical scoring, and arbitrary chunking strategies — can
deduce a legal boundary from unstructured text. Embeddings map semantic proximity: they tell you
that two passages are "about similar things." They cannot tell you whether a passage has the
authority to govern a specific question. A query for "access control under GDPR" returns HIPAA
chunks because the vectors are mathematically close, not because HIPAA governs EU data protection.

This is not a training deficiency. It is a mathematical limit. Bi-encoder dense retrievers perform
at or below random on negation-sensitive ranking tasks. Single-vector embeddings have expressiveness
ceilings — for any fixed dimension, there exist relevance sets that a single-vector retriever cannot
represent. Boolean-style exclusion cannot be delegated to dense similarity alone. In governed
domains (compliance, law, system architecture), semantic retrieval can route candidates, but it
cannot be trusted to enforce structural constraints.

## Context Collapse

When a Retrieval-Augmented Generation system retrieves chunks using unconstrained semantic
similarity, it creates Context Collapse: the seamless blending of text from conflicting
jurisdictions. An "access control" clause from GDPR Article 32 is stitched together with an "access
control" clause from HIPAA §164.312 simply because their embedding vectors are close. The LLM
receives a bucket of structurally orphaned, jurisdiction-blind chunks and is instructed to
"synthesize." Lacking deterministic boundaries, it stitches together conflicting requirements. The
output reads fluently but is legally incoherent.

Boundary Bleed is the operational consequence of Context Collapse. The system relies on semantic
probability rather than structural truth, producing answers that sound authoritative while mixing
requirements from frameworks that govern different populations, different data types, and different
enforcement regimes.

## The S.I.R.E. Architecture

S.I.R.E. solves Context Collapse by separating discovery from enforcement. It is a deterministic
Layer 0 architecture that intercepts the probabilistic results of standard hybrid search (pgvector +
tsvector), collapses the text into verified identity nodes, and applies strict structural
enforcement gates before LLM synthesis.

Each S.I.R.E. identity record is composed of four pillars with distinct operational roles:

- **Subject** — The taxonomic anchor. A domain label that permanently identifies the node (e.g.,
  "data_protection", "access_control"). Used for committee grouping and prompt headers. Not a
  runtime gate.
- **Included** — Editorial keywords explicitly mapped inside this subject domain. Used during
  identity resolution to strengthen the vote signal during Bottom-Up Discovery. Included informs
  search; it never vetoes.
- **Relevant** — Cross-framework IDs and version aliases for topological expansion. Defines
  structured mapping surfaces for crosswalk traversal. Used for discovery, not enforcement.
- **Excluded** — The sole deterministic enforcement gate. Anti-keywords that strictly disqualify a
  chunk from this domain at runtime. This is the only pillar that actively purges unauthorized text.

The asymmetry is deliberate: Subject anchors identity, Included and Relevant inform discovery and
topology, and Excluded enforces the hard boundary. Only Excluded can deterministically purge
evidence.

## Bottom-Up Discovery, Top-Down Enforcement

S.I.R.E. breaks the resolution paradox — "if you use semantic search to find the identity, haven't
you moved the vibes problem up one layer?" — through a two-phase pattern:

**Bottom-Up Discovery (Layer 3 to Layer 0):** A fuzzy query enters the system. Postgres hybrid
search returns a pool of candidate chunks. These chunks are treated purely as probabilistic votes
for their parent identities. The system groups chunks by identity, ranking by mean relevance score
to prevent chunk-density bias.

**Top-Down Enforcement (Layer 0 to Layer 2):** Semantic probability steps aside. The winning
identities load their deterministic Included and Excluded arrays and enforce them downward, purging
any chunk that violates the boundary. The LLM receives only structurally verified evidence organized
in Identity Envelopes — clean, jurisdiction-bound context.

## Graceful Degradation

S.I.R.E. is designed for progressive deployment, not big-bang migration:

- **NULL Identity:** Content without S.I.R.E. metadata bypasses gating entirely and is processed via
  standard RAG. This is the default state for all content before identity binding.
- **Empty Committee:** If no identity accumulates enough votes, the system falls back to standard
  synthesis with an explicit UNGATED flag. This is a bootstrapping safety net, not a steady-state
  path.
- **Suspicious Purge:** If enforcement purges all retrieved chunks, the system flags a
  SUSPICIOUS_PURGE metric rather than silently returning nothing. The identity header is still
  passed to the LLM with an empty evidence flag, forcing it to state the compliance gap explicitly.

## The Westlaw Strategy

S.I.R.E. rejects the universal ontology model. It is deployed asymmetrically:

- **Statistical Search:** Educational summaries and narrative content remain in standard vector
  retrieval. The existing pgvector + tsvector hybrid is effective for broad discovery.
- **Deterministic S.I.R.E.:** High-liability normative catalogs (ISO 27001 Annex A, EU AI Act
  articles, GDPR chapters) are upgraded to Layer 0. By scoping to normative catalogs first, the
  initial authoring burden drops to roughly 200 high-value identity nodes while covering the
  highest-liability content.

The economic insight is that not all content requires deterministic enforcement. Narrative
explanations benefit from semantic search. Normative rules — the content with legal consequences —
require structural truth.
