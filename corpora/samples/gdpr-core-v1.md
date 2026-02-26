---
corpus_id: gdpr-core-v1
title: GDPR Core Requirements
tier: tier_1
version: 1
content_type: prose
frameworks: [GDPR]
industries: [fintech, healthcare, saas, ecommerce]
segments: [enterprise, smb]
source_url: https://eur-lex.europa.eu/eli/reg/2016/679/oj
source_publisher: European Parliament and Council
last_verified: 2026-01-10
language: en
fact_check:
  status: verified
  checked_at: "2026-01-10"
  checked_by: Ontic Compliance Team
sire:
  subject: data_protection
  included: [personal data, data subject, controller, processor, DPIA, consent, lawful basis]
  excluded: [PHI, covered entity, business associate, HIPAA, ePHI]
  relevant: [ISO-27001:A.8, SOC2:CC6.1, CCPA]
---

## Lawful Basis for Processing

Organizations must establish a lawful basis before processing personal data. Article 6 of the GDPR
enumerates six lawful bases: consent, contract performance, legal obligation, vital interests,
public task, and legitimate interests. Each processing activity must be mapped to exactly one lawful
basis, documented in the organization's Record of Processing Activities (ROPA), and communicated to
data subjects via the privacy notice.

Consent must be freely given, specific, informed, and unambiguous. Pre-ticked boxes or silence do
not constitute valid consent. Controllers must be able to demonstrate that consent was obtained and
must provide a mechanism for withdrawal that is as easy as the mechanism for granting consent. When
processing is based on legitimate interests, a Legitimate Interest Assessment (LIA) must be
conducted and documented before processing begins.

## Data Subject Rights

Data subjects have the right to access, rectify, erase, restrict processing, data portability, and
object to processing of their personal data. Controllers must respond to data subject requests
within one calendar month, extendable by two additional months for complex requests. Responses must
be provided free of charge unless requests are manifestly unfounded or excessive.

### Right to Erasure

The right to erasure (right to be forgotten) requires controllers to delete personal data without
undue delay when the data is no longer necessary for its original purpose, consent is withdrawn, the
data subject objects and there are no overriding legitimate grounds, the data was unlawfully
processed, or erasure is required for legal compliance. Controllers must also notify downstream
processors of erasure requests.

### Right to Data Portability

Data subjects have the right to receive their personal data in a structured, commonly used, and
machine-readable format. This right applies only to data processed by automated means on the basis
of consent or contract. Controllers must transmit the data directly to another controller where
technically feasible.

## Data Protection by Design and Default

Article 25 requires controllers to implement appropriate technical and organizational measures
designed to implement data protection principles effectively. This includes data minimization —
processing only the personal data strictly necessary for the specified purpose. By default, only
personal data necessary for each specific purpose should be processed, considering the amount
collected, the extent of processing, the period of storage, and accessibility.

Controllers must conduct Data Protection Impact Assessments (DPIAs) before processing that is likely
to result in a high risk to data subjects. This includes systematic monitoring of publicly
accessible areas, large-scale processing of special categories of data, and automated
decision-making with legal or similarly significant effects.

## International Data Transfers

Personal data may only be transferred outside the European Economic Area (EEA) when adequate
safeguards are in place. Adequacy decisions by the European Commission permit transfers to countries
with equivalent data protection standards. In the absence of an adequacy decision, organizations
must rely on Standard Contractual Clauses (SCCs), Binding Corporate Rules (BCRs), or approved codes
of conduct.

### Transfer Impact Assessment

Following the Schrems II decision, organizations must conduct a Transfer Impact Assessment (TIA)
before relying on SCCs. The TIA must evaluate whether the destination country's legal framework
provides adequate protection, considering surveillance laws, access by public authorities, and
available legal remedies for data subjects.

## Breach Notification

Controllers must notify the relevant supervisory authority within 72 hours of becoming aware of a
personal data breach that is likely to result in a risk to data subjects. The notification must
describe the nature of the breach, the categories and approximate number of data subjects affected,
the likely consequences, and the measures taken or proposed to mitigate the breach.

When a breach is likely to result in a high risk to data subjects, the controller must also
communicate the breach directly to the affected individuals without undue delay. Communication may
be deferred only if authorized by the supervisory authority or if the data was rendered
unintelligible through encryption.

## Data Processing Agreements

Controllers must enter into a Data Processing Agreement (DPA) with every processor under Article 28.
The DPA must specify the subject matter and duration of processing, the nature and purpose of
processing, the types of personal data, and the categories of data subjects. Processors must not
engage sub-processors without prior written authorization from the controller. The DPA must include
provisions for audit rights, data return or deletion upon termination, and processor obligations
regarding breach notification to the controller.

## Records of Processing Activities

Controllers with more than 250 employees, or those conducting processing likely to result in a risk
to data subjects, must maintain a Record of Processing Activities (ROPA). The ROPA must include: the
controller's identity and contact details, purposes of processing, categories of data subjects and
personal data, categories of recipients, international transfer details, retention periods, and a
description of technical and organizational security measures.
