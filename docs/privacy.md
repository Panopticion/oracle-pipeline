---
title: Privacy Policy
description: "Privacy Policy for Panopticon AI and the corpus pipeline."
head:
  - - meta
    - property: og:title
      content: Privacy Policy — Panopticon AI
  - - meta
    - property: og:description
      content: Privacy Policy for Panopticon AI and the corpus pipeline documentation site.
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai/privacy
  - - meta
    - name: keywords
      content:
        privacy policy, Panopticon AI, corpus pipeline, data handling, telemetry, compliance
        documentation
---

# Privacy Policy

**Last updated:** February 25, 2026

Panopticon AI ("we", "us", "our") operates the panopticonlabs.ai website and the open-source corpus
pipeline software. This policy describes how we handle information.

## What We Collect

### Documentation Site (panopticonlabs.ai)

This site is a static documentation site. We do not:

- Require user accounts or login
- Use cookies for tracking
- Collect personal information
- Use third-party analytics
- Use advertising networks

We use VitePress local search, which runs entirely in your browser. No search queries are sent to
our servers.

### Open-Source Software

The corpus pipeline runs entirely in your infrastructure. We do not:

- Collect telemetry from the pipeline
- Phone home or ping external servers
- Access your corpus data, embeddings, or database
- Track usage of the software

The pipeline makes API calls to OpenAI for embedding generation. Those calls are made directly from
your infrastructure to OpenAI under your API key and OpenAI's privacy policy.

## Third-Party Services

- **GitHub** hosts our source code repository. GitHub's privacy policy applies to interactions with
  the repository (issues, pull requests, stars).
- **OpenAI** processes embedding requests when you run the pipeline with an OpenAI API key. OpenAI's
  privacy policy and data usage policy apply to those API calls.
- **Google Fonts** serves web fonts on this documentation site. Google's privacy policy applies.

## Data You Process

The corpus pipeline processes regulatory and compliance documents that you provide. This data:

- Stays in your Postgres database
- Is never transmitted to us
- Is governed by your own data handling policies
- May contain regulated information (GDPR personal data, HIPAA PHI, etc.) depending on your use case

You are responsible for ensuring your use of the pipeline complies with applicable regulations for
the data you process.

## Contact

For privacy questions: [support@panopticonlabs.ai](mailto:support@panopticonlabs.ai)
