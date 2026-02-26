---
corpus_id: healthcare-compliance-v1
title: Healthcare Data Compliance Guide
tier: tier_2
version: 1
content_type: prose
frameworks: [HIPAA, HITECH, FDA-21CFR11]
industries: [healthcare]
segments: [enterprise]
source_url: https://www.hhs.gov/hipaa/for-professionals/index.html
source_publisher: U.S. Department of Health and Human Services
last_verified: 2026-01-15
language: en
fact_check:
  status: verified
  checked_at: "2026-01-15"
  checked_by: Ontic Compliance Team
sire:
  subject: health_information_protection
  included: [PHI, ePHI, covered entity, business associate, minimum necessary, breach notification]
  excluded: [data subject, controller, processor, GDPR, DPIA, lawful basis]
  relevant: [NIST-SP-800-66, SOC2:CC6.1, HITRUST-CSF]
---

## Protected Health Information

Protected Health Information (PHI) includes any individually identifiable health information held or
transmitted by a covered entity or its business associate. This encompasses demographic data,
medical records, lab results, mental health information, insurance details, and any other
information that can be used to identify a patient. PHI exists in any form — electronic (ePHI),
paper, or oral.

The 18 HIPAA identifiers that make health information individually identifiable include: names,
geographic data smaller than a state, dates related to an individual, phone numbers, fax numbers,
email addresses, Social Security numbers, medical record numbers, health plan beneficiary numbers,
account numbers, certificate/license numbers, vehicle identifiers, device identifiers, web URLs, IP
addresses, biometric identifiers, full-face photographs, and any other unique identifying number or
code.

## The HIPAA Privacy Rule

The Privacy Rule establishes national standards for the protection of PHI. Covered entities may use
and disclose PHI without patient authorization only for treatment, payment, and healthcare
operations (TPO). All other uses and disclosures require a valid written authorization from the
patient that specifies the information to be disclosed, the purpose, the recipient, and an
expiration date.

### Minimum Necessary Standard

Covered entities must make reasonable efforts to limit PHI access to the minimum necessary to
accomplish the intended purpose. This requires implementing role-based access policies, reviewing
access levels periodically, and limiting queries and reports to only the data elements needed for a
given function. The minimum necessary standard does not apply to disclosures for treatment purposes
between healthcare providers.

### Notice of Privacy Practices

Every covered entity must provide patients with a Notice of Privacy Practices (NPP) that describes
how PHI may be used and disclosed, the patient's rights regarding their PHI, the entity's legal
duties, and a point of contact for complaints. The NPP must be provided at the first service
encounter and posted prominently in the facility.

## The HIPAA Security Rule

The Security Rule requires covered entities and business associates to implement administrative,
physical, and technical safeguards to ensure the confidentiality, integrity, and availability of
ePHI. Safeguards must be appropriate to the organization's size, complexity, capabilities, and the
probability and criticality of potential risks.

### Administrative Safeguards

Administrative safeguards include: designating a security official responsible for developing and
implementing security policies, conducting regular risk assessments to identify threats to ePHI,
implementing workforce training on security policies, establishing sanction policies for
non-compliance, and maintaining information system activity reviews (audit logs). Contingency plans
must address data backup, disaster recovery, and emergency mode operations.

### Technical Safeguards

Technical safeguards require: unique user identification for system access, emergency access
procedures, automatic logoff after periods of inactivity, encryption and decryption of ePHI, audit
controls that record and examine activity in systems containing ePHI, and mechanisms to authenticate
ePHI integrity. Transmission security controls must guard against unauthorized access to ePHI during
electronic transmission, including encryption of data in transit.

### Physical Safeguards

Physical safeguards address: facility access controls limiting physical access to systems containing
ePHI, workstation use policies specifying proper functions and physical attributes of workstations,
workstation security measures, and device and media controls governing the receipt, removal, and
disposal of hardware and electronic media containing ePHI.

## Business Associate Agreements

Any entity that creates, receives, maintains, or transmits PHI on behalf of a covered entity is a
business associate and must enter into a Business Associate Agreement (BAA). The BAA must specify
permitted uses and disclosures of PHI, require the business associate to implement appropriate
safeguards, mandate breach reporting, and ensure PHI is returned or destroyed upon contract
termination.

Cloud service providers, data analytics firms, EHR vendors, billing services, and IT consultants
that handle ePHI are all considered business associates regardless of whether they view the data
directly. A BAA must be in place before any PHI is shared.

## Breach Notification Requirements

The HITECH Act Breach Notification Rule requires covered entities to notify affected individuals
within 60 calendar days of discovering a breach of unsecured PHI. Breaches affecting 500 or more
individuals in a single jurisdiction must also be reported to the HHS Office for Civil Rights and
prominent media outlets simultaneously. Breaches affecting fewer than 500 individuals must be logged
and reported to HHS annually.

A breach is presumed unless the covered entity demonstrates through a risk assessment that there is
a low probability of PHI compromise, considering the nature and extent of the PHI involved, the
unauthorized person who used the PHI, whether the PHI was actually acquired or viewed, and the
extent to which the risk has been mitigated.

## FDA 21 CFR Part 11

For healthcare technology companies subject to FDA oversight, 21 CFR Part 11 establishes
requirements for electronic records and electronic signatures. Systems must include audit trails
that record the date, time, and identity of the person performing each action. Electronic signatures
must be unique to one individual and must not be reused or reassigned. Organizations must validate
systems to ensure accuracy, reliability, and consistent intended performance, and must maintain
documentation of the validation process throughout the system lifecycle.
