---
title: AI Compliance Standards
description:
  "How Panopticon AI maps to NIST AI RMF, EU AI Act, and DoD Responsible AI controls. Feature-level
  compliance matrix for regulatory audits."
head:
  - - meta
    - property: og:title
      content: AI Compliance Standards — Panopticon AI
  - - meta
    - property: og:description
      content:
        Feature-level compliance mapping to NIST AI RMF, EU AI Act Articles 10–14, and DoD
        Responsible AI principles.
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai/compliance
  - - meta
    - name: keywords
      content:
        NIST AI RMF, EU AI Act, DoD AI, compliance mapping, AI governance, data provenance,
        regulatory audit, SBOM, SCIF
---

# AI Compliance Standards

Panopticon was designed for organizations operating under AI regulation. This page maps **pipeline
features to specific control requirements** across NIST AI RMF, the EU AI Act, and DoD AI guidance.

The pipeline doesn't make you compliant by itself — no tool does. What it gives you is **auditable
infrastructure** that satisfies the data governance and provenance controls these frameworks
require.

## Standards Coverage Matrix

| Requirement Area                | NIST AI RMF              | EU AI Act         | DoD AI Principles    | Pipeline Feature                                                 |
| ------------------------------- | ------------------------ | ----------------- | -------------------- | ---------------------------------------------------------------- |
| Data provenance tracking        | MAP 1.5, MEASURE 2.6     | Art. 10(2)(f)     | Traceable            | Sovereignty attribution via CHECK constraint                     |
| Training data governance        | GOVERN 1.1, MAP 3.4      | Art. 10(2)        | Responsible          | Tiered corpus model (tier_1/2/3)                                 |
| Audit trail for AI systems      | GOVERN 4.1, MEASURE 4.2  | Art. 12(1)        | Governable           | Immutable pipeline envelopes                                     |
| Risk categorization             | MAP 1.1, GOVERN 1.7      | Art. 6, Annex III | —                    | Framework + industry metadata filtering                          |
| Transparency of AI outputs      | GOVERN 1.2, MEASURE 2.11 | Art. 13(1)        | Transparent          | Provenance watermarking on every chunk                           |
| Data integrity verification     | MANAGE 2.2, MEASURE 2.7  | Art. 10(3)        | Reliable             | SHA-256 content hashing + watermark verification                 |
| Human oversight capability      | GOVERN 1.4               | Art. 14(1)        | Governable           | Validation gate before ingestion                                 |
| Third-party dependency tracking | MAP 5.1, GOVERN 5.1      | Art. 10(2)(b)     | Responsible          | Egress policy registry with artifact hashes                      |
| Bias and quality monitoring     | MEASURE 2.6, MANAGE 1.3  | Art. 10(2)(d)     | Equitable            | Per-chunk confidence scores + fact-check gates                   |
| Incident response capability    | MANAGE 4.1               | Art. 62           | Governable           | Envelope query by run, corpus, authority, time range             |
| Software supply chain           | GOVERN 5.1               | Art. 10(2)(b)     | Responsible          | CycloneDX 1.5 SBOM (`sbom.json`) + egress policy hashes          |
| Air-gapped deployment           | —                        | —                 | Reliable, Governable | Zero runtime telemetry, self-contained SQL bootstrap, SCIF-ready |

## NIST AI Risk Management Framework (AI 100-1)

The [NIST AI RMF](https://www.nist.gov/artificial-intelligence/ai-risk-management-framework)
organizes risk management into four functions: **Govern, Map, Measure, Manage**. Panopticon
addresses the data infrastructure controls within each.

### GOVERN — Policies and accountability structures

| Control        | What NIST Requires                                                       | How the Pipeline Addresses It                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GOVERN 1.1** | Legal and regulatory requirements are understood and informed by context | Corpus metadata includes `frameworks[]` (GDPR, HIPAA, SOC2) and `industries[]` — knowledge is tagged by regulatory context at ingestion time, not post-hoc                                                                           |
| **GOVERN 1.2** | Trustworthy AI processes are documented and integrated                   | Every pipeline run produces an envelope attestation (`corpus_pipeline_envelopes`) recording who triggered it, what action ran, and what changed                                                                                      |
| **GOVERN 1.4** | Policies for human oversight are established                             | The `validate` action gates content before ingestion — pipelines can require human approval of validation results before proceeding to `ingest_and_embed`                                                                            |
| **GOVERN 4.1** | Organizational practices for documenting AI system behavior              | Pipeline envelopes and embedding events provide the complete audit trail. `corpus_pipeline_envelope_summary` view aggregates by run                                                                                                  |
| **GOVERN 5.1** | Third-party AI resources are documented                                  | The `egress_policies` table registers every network policy version with its `policy_hash` (SHA-256 of the deployed artifact). The `embedding_authorities` table registers every embedder with instance ID and container image digest |

### MAP — Contextualize the AI system

| Control     | What NIST Requires                                    | How the Pipeline Addresses It                                                                                                                                                                |
| ----------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MAP 1.1** | Intended purpose and context of use are characterized | The corpus tier system (`tier_1` = regulatory mandate, `tier_2` = industry standard, `tier_3` = best practice) categorizes knowledge by authority level                                      |
| **MAP 1.5** | Organizational risk tolerances are determined         | Sovereignty constraints make it impossible to store an embedding without declaring the authority and egress policy — risk tolerance is encoded at the database level, not left to convention |
| **MAP 3.4** | Risks from training and evaluation data are assessed  | The `fact_check` frontmatter block (reviewer, date, methodology) and the `requireFactCheck` pipeline option enforce review before production ingestion                                       |
| **MAP 5.1** | Third-party ML components are inventoried             | `embedding_authorities` records which service (with container digest) produced each embedding. Change the provider → register a new authority                                                |

### MEASURE — Analyze and assess

| Control          | What NIST Requires                                   | How the Pipeline Addresses It                                                                                                                                              |
| ---------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MEASURE 2.6**  | AI system performance and data quality are monitored | `corpus_embedding_events` logs every completion and failure at chunk level. `corpus_pipeline_envelope_summary` provides run-over-run comparison for detecting drift        |
| **MEASURE 2.7**  | AI system security and resilience are evaluated      | Content hashes (`SHA-256`) on both documents and chunks detect tampering. Watermark verification is self-contained — no database access required to prove a chunk's origin |
| **MEASURE 2.11** | Fairness and bias are assessed                       | Per-corpus `confidence` scores and multi-axis state tracking (`corpus_state_axes`) allow monitoring which knowledge areas have lower quality or coverage                   |
| **MEASURE 4.2**  | Measurement results are documented                   | All measurements are database-native. Envelopes, events, and summaries are queryable via standard SQL — no proprietary dashboard required                                  |

### MANAGE — Prioritize and act

| Control        | What NIST Requires                                  | How the Pipeline Addresses It                                                                                                                                            |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MANAGE 1.3** | Responses to identified risks are developed         | The `is_active` flag on documents + the active-document gating on retrieval functions allow immediate deactivation of problematic content without deleting history       |
| **MANAGE 2.2** | Mechanisms to manage AI risks are tested regularly  | The `rechunk` action re-processes existing corpora through the full validation → chunk → embed pipeline. Regression testing of knowledge quality is a single CLI command |
| **MANAGE 4.1** | Incident response plans cover AI-specific scenarios | Envelopes are queryable by time range, corpus, authority, and error status — `WHERE error IS NOT NULL` finds every failed run instantly                                  |

## EU AI Act

The [EU AI Act](https://artificialintelligenceact.eu/) imposes binding obligations on **high-risk AI
systems** (Annex III), including those used in critical infrastructure, employment, law enforcement,
and migration. Even general-purpose AI systems (Art. 52+) have transparency obligations.

### Article 10 — Data and Data Governance

> High-risk AI systems which make use of techniques involving the training of AI models with data
> shall be developed on the basis of training, validation and testing data sets that meet the
> quality criteria referred to in paragraphs 2 to 5.

| Art. 10 Paragraph | Requirement                                       | Pipeline Feature                                                                                                                                                          |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(2)(a)**        | Design choices for data collection                | Corpus authoring guide defines the format. Tiered system (`tier_1/2/3`) reflects the data authority hierarchy                                                             |
| **(2)(b)**        | Data provenance                                   | `embedding_authorities` + `egress_policies` + `corpus_pipeline_run_attestations` = full chain of custody from source document through embedding                           |
| **(2)(d)**        | Assessment of availability, quantity, suitability | Framework and industry metadata enable gap analysis — "which GDPR controls have tier_1 coverage vs. tier_3?" is a SQL query                                               |
| **(2)(f)**        | Examination of possible biases                    | Per-corpus confidence scores + multi-axis state tracking surface areas of uneven coverage. The `validate` gate flags structural issues before they enter the vector store |
| **(3)**           | Data governance and management practices          | The entire sovereignty layer (run attestations, embedding events, immutable egress policies) is a data governance system expressed as database constraints                |

### Article 12 — Record-Keeping

> High-risk AI systems shall technically allow for the automatic recording of events ('logs') over
> the lifetime of the system.

The pipeline's envelope system satisfies this directly:

- **`corpus_pipeline_envelopes`** — one row per corpus per run, recording action, validation result,
  ingestion action, embedding counts, timing, errors, and sovereignty bindings
- **`corpus_embedding_events`** — one row per chunk per embedding operation, recording completion
  time, authority, run ID, and error details for failures
- **`corpus_pipeline_envelope_summary`** — aggregated view by run for dashboard consumption
- All tables are **append-only** (insert-only RLS policies) — logs cannot be retroactively modified

### Article 13 — Transparency

> High-risk AI systems shall be designed and developed in such a way as to ensure that their
> operation is sufficiently transparent to enable deployers to interpret the system's output and use
> it appropriately.

Provenance watermarking addresses this requirement:

- Every chunk carries a `<!-- corpus-watermark:v1:... -->` signature
- Given any chunk, any party can call `verifyChunkWatermark()` to determine which corpus it came
  from, its sequence position, and whether the content has been tampered with
- This works **without database access** — the watermark is self-contained

### Article 14 — Human Oversight

> High-risk AI systems shall be designed and developed in such a way [...] as to enable them to be
> effectively overseen by natural persons.

The pipeline supports human-in-the-loop workflows:

- `validate` action runs all checks without modifying the database
- `ingest` and `ingest_and_embed` are separate actions — humans can review validation output before
  approving ingestion
- `is_active` flag allows immediate deactivation of any document from retrieval results

## DoD AI Principles (Responsible AI)

The
[DoD AI Principles](https://www.ai.mil/docs/Responsible_AI_Strategy_and_Implementation_Pathway_June_2022.pdf)
define five ethical principles for military AI systems. While Panopticon is a general-purpose
pipeline, its design aligns with four of the five.

| DoD Principle   | Definition                                                                                                     | Pipeline Alignment                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsible** | Personnel will exercise appropriate judgment and remain responsible for AI development and deployment          | Tiered corpus model explicit about authority level. Sovereignty bindings trace every embedding to a registered human-administered authority                     |
| **Equitable**   | AI capabilities will be developed to minimize unintended bias                                                  | Multi-framework and multi-industry metadata enables bias surface analysis. Confidence scoring surfaces uneven knowledge quality                                 |
| **Traceable**   | AI capabilities will be developed with transparent and auditable methods, data sources, and processes          | Full provenance chain: corpus → document → chunk → embedding authority → egress policy → run attestation. Watermarks provide offline verification               |
| **Reliable**    | AI capabilities will have explicit, well-defined uses and safety should be assured across the lifecycle        | Content hash integrity checking (SHA-256), lease-based concurrency with dead-letter recovery, and the validation gate all contribute to operational reliability |
| **Governable**  | AI capabilities will be designed to fulfill their intended functions while possessing the ability to disengage | `is_active` flag + active-document gating = instant disengagement at the document level. RLS policies enforce role-based access. Validation can block ingestion |

## What the Pipeline Does NOT Cover

Being honest about boundaries is part of compliance. Panopticon handles the **data governance
layer** — ingestion provenance, attribution, integrity, and auditability. It does not cover:

| Area                         | Not Covered                                                                 | What You Need                                                                 |
| ---------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Retrieval-layer fairness** | The pipeline stores vectors; it doesn't control how your RAG retrieves them | Retrieval-side filtering, re-ranking, and bias testing in your application    |
| **LLM output monitoring**    | The pipeline feeds your LLM context; it doesn't monitor what the LLM says   | Output guardrails, hallucination detection, toxicity filtering                |
| **Organizational AIMS**      | The pipeline is infrastructure; it isn't an AI Management System            | ISO 42001 AIMS implementation, risk registers, organizational policies        |
| **Penetration testing**      | Schema uses RLS + role separation, but hasn't been independently audited    | Third-party security assessment for production deployments                    |
| **Continuous monitoring**    | Envelopes log what happened; they don't alert when something goes wrong     | Alerting integration (CloudWatch, Datadog, PagerDuty) on envelope error rates |

## SCIF-Ready Deployment

Panopticon is designed for deployment in **air-gapped and SCIF (Sensitive Compartmented Information
Facility)** environments. The architecture has zero hard dependencies on external services at
runtime:

### Why This Is SCIF-Compatible

| Property                         | Detail                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No runtime telemetry**         | The pipeline sends zero analytics, metrics, or heartbeats to any external endpoint. All logging is local                                                                |
| **No package-level phone-home**  | No dependency calls home at `import` or `require` time                                                                                                                  |
| **Self-contained SQL bootstrap** | All 11 SQL files run via `psql` against a local Postgres instance. No migration service, no cloud API                                                                   |
| **PostgREST, not a cloud SDK**   | `@supabase/supabase-js` is used purely as a PostgREST HTTP client. Replace it with raw `fetch()` against any PostgREST instance — zero Supabase infrastructure required |
| **Embedding is optional**        | `validate` and `ingest` actions work without any OpenAI call. For SCIF deployments, ingest locally and embed via an air-gapped model (see below)                        |
| **CycloneDX SBOM included**      | `sbom.json` ships with every release — a machine-readable inventory of every dependency, version, and license for supply chain review                                   |

### Air-Gapped Embedding

The default pipeline uses OpenAI `text-embedding-3-large` over HTTPS. In a SCIF, replace this with a
local embedding model:

1. **Ingest without embedding**: `npx tsx src/cli.ts --action ingest` — validates and chunks
   locally, marks chunks as `embed_status = 'pending'`
2. **Embed locally**: Write a worker that reads pending chunks from `corpus_chunks`, calls a local
   model (e.g., Ollama, vLLM, or a SentenceTransformers container), and updates `embedding` +
   `embed_status` via PostgREST
3. **Register a local authority**: Insert into `embedding_authorities` with `environment = 'scif'`
   and `container_image_digest` pointing to your local model image

The sovereignty CHECK constraint still applies — local embeddings must still reference a registered
authority and egress policy. The egress policy for a SCIF deployment would reflect
`scope = 'airgap'` with `policy_hash` referencing your network isolation artifact.

### Software Bill of Materials (SBOM)

The repository includes a [CycloneDX 1.5](https://cyclonedx.org/) SBOM at `sbom.json`, generated
via:

```bash
npm run sbom
```

This produces a machine-readable JSON inventory listing every dependency with:

- Package name, version, and license
- Dependency tree (direct vs. transitive)
- Package URLs (purl) for vulnerability cross-referencing
- Hashes for integrity verification

CycloneDX is the SBOM format recognized by [NIST SSDF](https://csrc.nist.gov/projects/ssdf),
[Executive Order 14028](https://www.whitehouse.gov/briefing-room/presidential-actions/2021/05/12/executive-order-on-improving-the-nations-cybersecurity/)
(§4), and the DoD's
[DevSecOps Reference Design](https://dodcio.defense.gov/Portals/0/Documents/Library/DevSecOpsReferenceDesign.pdf).
For DoD ATO (Authority to Operate) packages, include `sbom.json` alongside your system security
plan.

To verify dependencies against known vulnerabilities:

```bash
# Audit with npm
npm audit

# Or feed the SBOM into your scanner
grype sbom.json          # Anchore Grype
trivy sbom sbom.json     # Aqua Trivy
```

## Using This for Auditors

When an auditor asks "how do you track the provenance of data used by your AI system," point them
to:

1. **`corpus_pipeline_run_attestations`** — every pipeline invocation with its sovereignty bindings
2. **`corpus_pipeline_envelopes`** — per-corpus results including validation, ingestion, and
   embedding outcomes
3. **`corpus_embedding_events`** — per-chunk embedding lifecycle (completed/failed)
4. **`corpus_chunks.embedding_authority_id`** — the CHECK constraint that makes un-attributed
   vectors impossible
5. **`verifyChunkWatermark()`** — offline proof of chunk origin and integrity

The schema is designed so that `SELECT * FROM corpus_pipeline_envelope_summary WHERE run_id = $1`
answers most auditor questions about a specific pipeline run in a single query.

---

_Standards referenced:
[NIST AI 100-1 v1.0](https://www.nist.gov/artificial-intelligence/ai-risk-management-framework) (Jan
2023), [EU AI Act 2024/1689](https://artificialintelligenceact.eu/) (Aug 2024),
[DoD Responsible AI Strategy](https://www.ai.mil/docs/Responsible_AI_Strategy_and_Implementation_Pathway_June_2022.pdf)
(Jun 2022),
[EO 14028 — Improving the Nation's Cybersecurity](https://www.whitehouse.gov/briefing-room/presidential-actions/2021/05/12/executive-order-on-improving-the-nations-cybersecurity/)
(May 2021), [NIST SSDF SP 800-218](https://csrc.nist.gov/projects/ssdf) (Feb 2022). SBOM format:
[CycloneDX 1.5](https://cyclonedx.org/specification/overview/). This mapping reflects Panopticon
v0.1.0 capabilities. It is not legal advice._
