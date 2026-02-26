---
corpus_id: ai-usage-boundaries-v1
title: AI Usage Boundaries
tier: tier_3
version: 1
content_type: boundary
frameworks: [NIST-AI-RMF, EU-AI-Act]
industries: [saas, fintech, healthcare]
segments: [enterprise, smb]
source_url: https://www.nist.gov/artificial-intelligence/executive-order-safe-secure-and-trustworthy-artificial-intelligence
source_publisher: Ontic Compliance Team
last_verified: 2026-01-20
language: en
fact_check:
  status: verified
  checked_at: "2026-01-20"
  checked_by: Ontic Compliance Team
sire:
  subject: ai_governance_boundaries
  included: [AI system, human review, embedding, classification, gap analysis, sovereignty]
  excluded: []
  relevant: [NIST-AI-RMF, EU-AI-Act:Art.14, ISO-42001]
---

## Allowed Behaviors

### AI may summarize regulatory text for human review

AI systems may generate summaries of regulatory documents, compliance frameworks, and legal texts
when the output is presented as a draft for human review. Summaries must be clearly labeled as
AI-generated and must include a reference to the source document. The human reviewer must have
access to the original text and must confirm the summary before it is used in compliance decisions,
customer communications, or audit documentation.

### AI may classify documents by regulatory framework

Automated classification of incoming documents into regulatory categories (e.g., GDPR, HIPAA, SOC 2)
is permitted when the classification model has been validated against a labeled test set with
documented precision and recall metrics. Misclassification rates must be monitored and
classifications that fall below the confidence threshold (default: 0.85) must be routed to a human
reviewer.

### AI may draft internal policy recommendations

AI systems may generate draft policy recommendations based on corpus content and organizational
context. Drafts must be routed through the organization's policy review workflow and must not be
published or enforced without explicit human approval. The AI-generated draft must be versioned and
the approval chain must be captured in the audit log.

### AI may generate embedding vectors for retrieval

AI systems may generate embedding vectors from corpus content for the purpose of semantic search and
retrieval. The embedding process must operate within the VPC sovereignty framework, use an approved
embedding authority, and log all operations to the corpus embedding events table. Embedding models
and dimensions must be consistent across the corpus corpus.

### AI may assist with gap analysis reports

AI systems may compare an organization's policy set against a regulatory framework and generate gap
analysis reports identifying missing or insufficient controls. Gap reports must include specific
citations to the relevant corpus sections and must distinguish between confirmed gaps and areas
requiring further investigation. Reports must be reviewed by a qualified compliance professional
before distribution.

## Prohibited Behaviors

### AI must not make autonomous compliance decisions

No AI system may autonomously determine that an organization is compliant or non-compliant with a
regulatory requirement. Compliance determinations require human judgment and must be made by a
qualified individual who has reviewed the relevant evidence. AI may surface evidence and
recommendations, but the compliance determination must always be a human decision captured in the
audit trail.

### AI must not generate legal advice

AI systems must not produce output that constitutes legal advice, including specific recommendations
on how to respond to regulatory enforcement actions, interpretations of how a regulation applies to
a specific fact pattern, or guidance on contractual obligations. AI may surface relevant regulatory
text and precedent, but must include a disclaimer that the output is informational only and does not
constitute legal advice.

### AI must not process PII outside the sovereignty boundary

AI systems must not transmit personally identifiable information or protected health information to
embedding or inference endpoints outside the organization's defined VPC sovereignty boundary. All
PII must be stripped or pseudonymized before any data leaves the sovereignty perimeter. The egress
policy must be enforced at the database level and violations must trigger an immediate alert.

### AI must not hallucinate regulatory citations

AI-generated content that references specific regulatory articles, sections, or clauses must be
grounded in corpus content from the vector store. Free-form generation of regulatory citations
without retrieval-augmented grounding is prohibited. If the retrieval step returns no relevant
chunks above the similarity threshold, the system must state that it cannot find a relevant citation
rather than generating one.

### AI must not bypass human-in-the-loop for high-risk actions

High-risk actions — including publishing compliance attestations, submitting regulatory filings,
modifying access control policies, or deleting audit records — must not be triggered by AI alone.
Every high-risk action must pass through a human-in-the-loop gate where a named individual reviews
and approves the action. The approval must be logged with the individual's identity, timestamp, and
the specific action approved.

### AI must not retain conversation context containing PHI

AI systems that interact with users via chat or conversational interfaces must not persist
conversation turns that contain PHI or PII beyond the active session. Session data must be purged
upon session termination. If conversation history is needed for quality assurance, it must be
anonymized before storage and retained only for the minimum period required by the organization's
data retention policy.

## Escalation Requirements

### Ambiguous cases must be escalated to compliance review

When an AI system encounters a scenario that falls outside the explicitly allowed and prohibited
behaviors defined in this corpus, it must escalate the decision to the compliance review queue. The
escalation must include the full context — the user query, the retrieved corpus chunks, the proposed
action, and the confidence score. A compliance reviewer must resolve the escalation within the SLA
defined in the organization's compliance operating procedures.

### Boundary violations must generate audit events

Any attempt to perform a prohibited behavior must generate an audit event in the compliance audit
log. The event must capture the action attempted, the user or system that triggered it, the boundary
rule that was violated, and the enforcement action taken (e.g., request blocked, response redacted,
escalation created). Audit events for boundary violations must be retained for the duration
specified in the organization's audit retention policy, with a minimum of seven years for regulated
industries.
