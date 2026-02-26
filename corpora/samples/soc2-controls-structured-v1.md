---
corpus_id: soc2-controls-structured-v1
title: SOC 2 Trust Services Criteria — Control Mapping
tier: tier_2
version: 1
content_type: structured
frameworks: [SOC2]
industries: [saas, fintech, cloud]
segments: [enterprise]
source_url: https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2
source_publisher: AICPA
last_verified: 2026-01-12
language: en
fact_check:
  status: verified
  checked_at: "2026-01-12"
  checked_by: Ontic Compliance Team
sire:
  subject: trust_services_criteria
  included: [control, common criteria, availability, confidentiality, processing integrity, privacy]
  excluded: [data subject, PHI, covered entity, GDPR, HIPAA]
  relevant: [ISO-27001, NIST-CSF, HITRUST-CSF]
---

## Security (Common Criteria)

The Security category addresses the protection of information and systems against unauthorized
access. It is the only required category in a SOC 2 examination — all other categories are optional.

```json
[
  {
    "control_id": "CC1.1",
    "title": "Control Environment — Commitment to Integrity and Ethics",
    "description": "The entity demonstrates a commitment to integrity and ethical values.",
    "typical_evidence": [
      "Code of conduct",
      "Ethics training records",
      "Board oversight documentation"
    ],
    "test_frequency": "annual"
  },
  {
    "control_id": "CC1.2",
    "title": "Control Environment — Board Oversight",
    "description": "The board of directors demonstrates independence from management and exercises oversight of internal controls.",
    "typical_evidence": [
      "Board meeting minutes",
      "Audit committee charter",
      "Independence attestations"
    ],
    "test_frequency": "annual"
  },
  {
    "control_id": "CC2.1",
    "title": "Communication and Information — Information Quality",
    "description": "The entity obtains or generates and uses relevant, quality information to support the functioning of internal controls.",
    "typical_evidence": [
      "Data quality procedures",
      "Information flow diagrams",
      "Monitoring reports"
    ],
    "test_frequency": "annual"
  },
  {
    "control_id": "CC3.1",
    "title": "Risk Assessment — Objective Specification",
    "description": "The entity specifies objectives with sufficient clarity to enable identification and assessment of risks.",
    "typical_evidence": ["Risk register", "Objective documentation", "Risk assessment methodology"],
    "test_frequency": "annual"
  },
  {
    "control_id": "CC5.1",
    "title": "Control Activities — Selection and Development",
    "description": "The entity selects and develops control activities that contribute to the mitigation of risks to acceptable levels.",
    "typical_evidence": ["Control matrix", "Policy documents", "Procedure documentation"],
    "test_frequency": "annual"
  },
  {
    "control_id": "CC6.1",
    "title": "Logical and Physical Access — Logical Access Security",
    "description": "The entity implements logical access security over information assets to protect them from security events.",
    "typical_evidence": [
      "Access control policy",
      "User provisioning records",
      "Access reviews",
      "MFA configuration"
    ],
    "test_frequency": "quarterly"
  },
  {
    "control_id": "CC6.2",
    "title": "Logical and Physical Access — User Registration and Authorization",
    "description": "Prior to issuing system credentials, the entity registers and authorizes new users.",
    "typical_evidence": [
      "User onboarding workflow",
      "Approval records",
      "Role assignment documentation"
    ],
    "test_frequency": "quarterly"
  },
  {
    "control_id": "CC6.3",
    "title": "Logical and Physical Access — Credential Lifecycle",
    "description": "The entity manages credentials for infrastructure and software to prevent unauthorized access.",
    "typical_evidence": [
      "Password policy",
      "Key rotation records",
      "Secret management tool config"
    ],
    "test_frequency": "quarterly"
  },
  {
    "control_id": "CC7.1",
    "title": "System Operations — Infrastructure Monitoring",
    "description": "The entity uses detection and monitoring procedures to identify anomalies that could indicate security events.",
    "typical_evidence": [
      "SIEM configuration",
      "Alert rules",
      "Monitoring dashboards",
      "Incident response playbooks"
    ],
    "test_frequency": "continuous"
  },
  {
    "control_id": "CC7.2",
    "title": "System Operations — Incident Response",
    "description": "The entity monitors system components and evaluates detected anomalies against incident response procedures.",
    "typical_evidence": [
      "Incident response plan",
      "Incident tickets",
      "Post-mortem reports",
      "Escalation matrix"
    ],
    "test_frequency": "annual"
  },
  {
    "control_id": "CC8.1",
    "title": "Change Management — Change Authorization",
    "description": "The entity authorizes, designs, develops, configures, documents, tests, and approves changes before implementation.",
    "typical_evidence": [
      "Change management policy",
      "Pull request reviews",
      "Deployment approvals",
      "Rollback procedures"
    ],
    "test_frequency": "continuous"
  },
  {
    "control_id": "CC9.1",
    "title": "Risk Mitigation — Vendor and Business Partner Risk",
    "description": "The entity identifies and assesses risks from vendors, business partners, and other parties.",
    "typical_evidence": [
      "Vendor risk assessments",
      "Third-party SOC reports",
      "Vendor inventory",
      "BAAs/DPAs"
    ],
    "test_frequency": "annual"
  }
]
```

## Availability

The Availability category addresses whether the system is available for operation and use as
committed or agreed. This is an optional Trust Services Category but is commonly included for SaaS
companies.

```json
[
  {
    "control_id": "A1.1",
    "title": "Availability — Capacity Management",
    "description": "The entity maintains, monitors, and evaluates current processing capacity and use of system components.",
    "typical_evidence": [
      "Capacity planning documents",
      "Auto-scaling configuration",
      "Performance monitoring dashboards"
    ],
    "test_frequency": "quarterly"
  },
  {
    "control_id": "A1.2",
    "title": "Availability — Recovery and Continuity",
    "description": "The entity authorizes, designs, develops, and implements activities to recover from disruptions.",
    "typical_evidence": [
      "Business continuity plan",
      "DR test results",
      "RTO/RPO documentation",
      "Backup verification logs"
    ],
    "test_frequency": "annual"
  },
  {
    "control_id": "A1.3",
    "title": "Availability — Backup and Restoration Testing",
    "description": "The entity tests recovery plan procedures supporting system recovery to meet its objectives.",
    "typical_evidence": ["Backup test results", "Restoration drill logs", "Failover test results"],
    "test_frequency": "semi-annual"
  }
]
```

## Confidentiality

The Confidentiality category addresses whether information designated as confidential is protected
as committed or agreed. Organizations that handle proprietary data, trade secrets, or
business-sensitive information should include this category.

```json
[
  {
    "control_id": "C1.1",
    "title": "Confidentiality — Identification and Classification",
    "description": "The entity identifies and maintains confidential information to meet the entity's objectives related to confidentiality.",
    "typical_evidence": [
      "Data classification policy",
      "Data inventory",
      "Labeling procedures",
      "DLP configuration"
    ],
    "test_frequency": "annual"
  },
  {
    "control_id": "C1.2",
    "title": "Confidentiality — Disposal and Protection",
    "description": "The entity disposes of confidential information to meet objectives related to confidentiality.",
    "typical_evidence": [
      "Data retention and disposal policy",
      "Disposal certificates",
      "Secure deletion logs"
    ],
    "test_frequency": "annual"
  }
]
```

## Processing Integrity

The Processing Integrity category addresses whether system processing is complete, valid, accurate,
timely, and authorized. This category is important for companies that process financial
transactions, analytics, or other data where correctness is critical.

```json
[
  {
    "control_id": "PI1.1",
    "title": "Processing Integrity — Quality Objectives",
    "description": "The entity obtains or generates, uses, and communicates information regarding quality objectives.",
    "typical_evidence": [
      "Input validation rules",
      "Processing reconciliation reports",
      "Error handling procedures"
    ],
    "test_frequency": "continuous"
  },
  {
    "control_id": "PI1.2",
    "title": "Processing Integrity — Completeness and Accuracy Checks",
    "description": "The entity implements policies to ensure completeness and accuracy during input, processing, and output.",
    "typical_evidence": [
      "Data validation logs",
      "Batch reconciliation results",
      "Output verification procedures"
    ],
    "test_frequency": "continuous"
  }
]
```

## Privacy

The Privacy category addresses whether personal information is collected, used, retained, disclosed,
and disposed of in conformity with the entity's privacy commitments. This maps closely to regulatory
requirements like GDPR and CCPA.

```json
[
  {
    "control_id": "P1.1",
    "title": "Privacy — Notice and Consent",
    "description": "The entity provides notice and obtains consent regarding the collection, use, and disclosure of personal information.",
    "typical_evidence": [
      "Privacy notice",
      "Consent records",
      "Cookie consent management",
      "Opt-out mechanisms"
    ],
    "test_frequency": "annual"
  },
  {
    "control_id": "P4.1",
    "title": "Privacy — Access and Correction",
    "description": "The entity provides data subjects with access to their personal information for review and correction.",
    "typical_evidence": ["DSAR workflow", "Response time records", "Data export functionality"],
    "test_frequency": "annual"
  },
  {
    "control_id": "P6.1",
    "title": "Privacy — Data Quality and Retention",
    "description": "The entity collects only the personal information relevant to the purposes identified and retains it only as long as necessary.",
    "typical_evidence": ["Data minimization policy", "Retention schedule", "Automated purge logs"],
    "test_frequency": "annual"
  }
]
```
