---
corpus_id: crosswalk-gdpr-hipaa-soc2-v1
title: Crosswalk — GDPR ↔ HIPAA ↔ SOC 2
tier: tier_2
version: 1
content_type: prose
frameworks: [GDPR, HIPAA, SOC2]
industries: [healthcare, saas, fintech]
segments: [enterprise]
source_url: https://www.ontic.ai/docs/crosswalks
source_publisher: Ontic Compliance Team
last_verified: 2026-01-18
language: en
fact_check:
  status: verified
  checked_at: "2026-01-18"
  checked_by: Ontic Compliance Team
sire:
  subject: cross_framework_mapping
  included: [crosswalk, access control, encryption, breach notification, audit, risk assessment]
  excluded: []
  relevant: [GDPR, HIPAA, SOC2, ISO-27001, NIST-CSF]
---

## Access Control

GDPR Article 32(1)(b) requires the ability to ensure the ongoing confidentiality, integrity,
availability, and resilience of processing systems. HIPAA Security Rule §164.312(a)(1) requires
covered entities to implement technical policies and procedures that allow access only to persons or
software programs granted access rights. SOC 2 CC6.1 requires implementation of logical access
security over information assets to protect them from security events.

All three frameworks converge on role-based access control (RBAC) with least-privilege assignments.
An organization that implements RBAC with documented roles, periodic access reviews, and
multi-factor authentication will satisfy the access control requirements across all three frameworks
simultaneously. The key difference is scope: GDPR applies to personal data, HIPAA to ePHI
specifically, and SOC 2 to the broader information system.

## Encryption Requirements

GDPR Article 32(1)(a) lists encryption as an appropriate technical measure for ensuring security of
processing. HIPAA §164.312(a)(2)(iv) requires encryption of ePHI at rest, and §164.312(e)(2)(ii)
requires encryption of ePHI in transit — though HIPAA treats encryption as an "addressable"
specification, meaning organizations must implement it or document why an equivalent alternative is
reasonable. SOC 2 CC6.7 addresses encryption of data transmitted over public networks.

For practical purposes, organizations subject to all three frameworks should implement AES-256
encryption at rest and TLS 1.2+ in transit. This satisfies GDPR and SOC 2 directly and satisfies
HIPAA without the need for an alternative justification. Key management must follow documented
procedures including rotation schedules and access controls on key material.

## Breach Notification

GDPR Article 33 requires notification to the supervisory authority within 72 hours of becoming aware
of a breach involving personal data. HIPAA Breach Notification Rule (45 CFR §§164.400-414) requires
notification to affected individuals within 60 calendar days and to HHS for breaches affecting 500+
individuals. SOC 2 CC7.3 requires the entity to evaluate security events and communicate incidents
in accordance with its defined procedures.

The crosswalk implication is that organizations must maintain a breach response plan that satisfies
the shortest deadline (GDPR's 72 hours to the authority). HIPAA's 60-day deadline applies to
individual notification, not the initial authority report. SOC 2 does not prescribe a specific
timeline but requires documented procedures — organizations should define timelines that meet the
GDPR and HIPAA requirements.

### Notification Content Comparison

GDPR breach notification must include: the nature of the breach, categories and approximate number
of data subjects affected, the DPO's contact details, likely consequences, and measures taken to
mitigate the breach. HIPAA breach notification must include: a description of the breach, the types
of information involved, steps individuals should take, what the entity is doing to investigate and
mitigate, and contact procedures. SOC 2 requires the organization to follow its own incident
communication procedures as documented.

An organization maintaining a single breach notification template should include all elements from
both GDPR and HIPAA requirements, plus the SOC 2-required internal communication channels. This
unified template satisfies all three frameworks.

## Data Minimization and Retention

GDPR Article 5(1)(c) requires that personal data be adequate, relevant, and limited to what is
necessary. HIPAA's Minimum Necessary Standard (§164.502(b)) requires covered entities to limit PHI
use, disclosure, and requests to the minimum necessary for the intended purpose. SOC 2 C1.1 requires
identification and classification of confidential information and its retention per documented
policy.

The practical crosswalk: implement a data inventory that classifies all data by type (personal data,
PHI, confidential business data), maps each data element to a processing purpose, defines retention
periods based on the most restrictive applicable requirement, and enforces automated purging when
retention periods expire. GDPR and HIPAA both require documented justification for the retention
period chosen.

## Risk Assessment

GDPR Article 35 requires a Data Protection Impact Assessment (DPIA) for high-risk processing. HIPAA
§164.308(a)(1)(ii)(A) requires an accurate and thorough assessment of potential risks and
vulnerabilities to ePHI. SOC 2 CC3.1 requires the entity to specify objectives with sufficient
clarity to enable identification and assessment of risks.

All three frameworks require regular, documented risk assessments — but differ in scope and trigger.
GDPR DPIAs are triggered by specific processing types (e.g., large-scale profiling, systematic
monitoring). HIPAA risk assessments should be comprehensive and updated when operational changes
occur. SOC 2 risk assessments are tied to the entity's defined objectives and must be updated at
least annually.

A unified risk assessment program should: run comprehensive assessments annually, trigger targeted
assessments for new processing activities or system changes, maintain a risk register that maps
risks to all applicable frameworks, and document risk treatment decisions including acceptance,
mitigation, transfer, or avoidance. This single process satisfies all three frameworks.

## Vendor Management

GDPR Article 28 requires data processing agreements with processors. HIPAA §164.502(e) and
§164.504(e) require Business Associate Agreements (BAAs) with entities that handle PHI. SOC 2 CC9.1
requires identification and assessment of risks from vendors, business partners, and other parties.

Organizations subject to all three frameworks must maintain a vendor inventory that identifies each
vendor's access to data types (personal data, PHI, confidential data), classify vendors by risk
level, require appropriate agreements (DPA for GDPR, BAA for HIPAA, NDA + security requirements for
SOC 2), collect and review vendor security evidence (SOC 2 reports, penetration test results,
security questionnaires), and re-assess vendor risk at least annually. A single vendor management
program with this structure satisfies all three frameworks.

## Audit and Accountability

GDPR Article 5(2) establishes the accountability principle — the controller must be able to
demonstrate compliance. HIPAA §164.312(b) requires audit controls that record and examine activity
in systems containing ePHI. SOC 2 CC4.1 requires the entity to select, develop, and perform
evaluations to ascertain whether controls are present and functioning.

The crosswalk: implement centralized audit logging that captures all access to personal data and
PHI, retain audit logs for the most restrictive applicable period (typically seven years for
healthcare), ensure logs are tamper-evident and include user identity, timestamp, action, and data
accessed, and review logs regularly with documented findings and remediation actions. This unified
audit approach satisfies all three frameworks and supports annual SOC 2 examination evidence
collection.
