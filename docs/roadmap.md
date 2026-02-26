---
title: Product Roadmap
description:
  "Contributor roadmap for Panopticon AI: phased plan from ingestion pipeline to API platform."
head:
  - - meta
    - property: og:title
      content: Product Roadmap — Panopticon AI
  - - meta
    - property: og:description
      content:
        Contributor roadmap from the current corpus ingestion pipeline to multi-tenant API, document
        intake, Claude integration, and ops hardening.
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai/roadmap
  - - meta
    - name: keywords
      content: roadmap, contributors, Panopticon AI, Hono API, MCP, document intake, observability
---

# Product Roadmap

This roadmap tracks the planned evolution of Panopticon from a compliance-grade ingestion pipeline
into a multi-tenant knowledge API platform.

## Current State (Today)

Panopticon currently ships:

- TypeScript package API (`@panopticon/corpus-pipeline`)
- CLI (`npx tsx src/cli.ts --action ...`)
- SQL retrieval/RPC functions (`match_corpus_chunks`, `match_corpus_chunks_hybrid`, etc.) callable
  via PostgREST
- **AI document parsing** — CFPO-prompted parse of raw compliance text into structured corpus
  Markdown
- **Web UI** — TanStack Start app with Supabase Auth, session management, AI parsing, crosswalk
  generation, and ZIP download

## Completed Phases

### Phase 0 — Auth ✓

Supabase Auth with email/password, magic link, password reset. Session-based auth in the web UI.
Email templates for all 6 Supabase auth flows (confirm signup, invite, magic link, change email,
reset password, reauthentication).

### Phase 2 — Document Intake ✓

Upload raw compliance text (TXT/Markdown) into sessions. AI-parse with CFPO-structured prompts into
corpus Markdown with S.I.R.E. identity metadata, frontmatter, and fact-check attestations.
Human-in-the-loop editing before finalization.

### Phase 3 — Claude Integration ✓

MCP server shipped. Two tools: `search_compliance_corpus` (semantic search) and
`verify_chunk_provenance` (offline watermark verification). Works with Claude Desktop, Claude Code,
and any MCP client. [MCP docs →](/mcp)

### Phase 5 — Web UI & Crosswalk ✓

TanStack Start web application at [panopticonlabs.ai](https://panopticonlabs.ai):

- **Sessions** — group related compliance document uploads into batches
- **AI parsing** — CFPO prompt orchestration via OpenRouter (Claude Sonnet)
- **Crosswalk generation** — AI maps controls across all uploaded frameworks in a session
- **Download bundle** — ZIP with all parsed documents, crosswalk, and auto-generated README
- **Zustand state management** — client-side store hydrated from SSR loader data

## Planned Phases

### Phase 1 — HTTP API

Hono-based API layer (Node/Bun) on top of existing pipeline and PostgREST RPC primitives.

### Phase 4 — Ops Hardening

Rate limiting, usage metering, structured observability, and production telemetry.

## Contributor Tasks

Each phase includes scoped `good_first_contributions` tasks in the source roadmap file.

- Source of truth:
  [docs/panopticon-plan.yaml](https://github.com/Panopticion/corpora-pipeline/blob/main/docs/panopticon-plan.yaml)
- Open an issue referencing the phase and task you want to take on.
