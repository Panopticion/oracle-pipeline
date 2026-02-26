---
title: System Prompt Engineering (CFPO)
description:
  "How to structure LLM system prompts for compliance-grade RAG using the CFPO convention. Inject
  attributed corpus chunks with tier authority and citation enforcement."
head:
  - - meta
    - property: og:title
      content: System Prompt Engineering (CFPO) — Panopticon AI
  - - meta
    - property: og:description
      content:
        Structure LLM system prompts for compliance RAG with the CFPO five-section convention.
        Tier-aware citations, refusal behavior, enforcement examples.
  - - meta
    - property: og:url
      content: https://panopticonlabs.ai/prompt-engineering
  - - meta
    - name: keywords
      content:
        CFPO, system prompt engineering, RAG prompt, compliance AI, prompt template, LLM grounding,
        citation enforcement, tier authority
---

# System Prompt Engineering

You've ingested and embedded compliance knowledge. Now you need your LLM to **use** it correctly —
cite sources, respect tier authority, refuse when the knowledge base has gaps, and never hallucinate
regulatory advice.

This guide introduces **CFPO (Compliance-First Prompt Orchestration)**, a system prompt structure
designed for AI systems that retrieve from attributed vector stores. It works with any LLM (OpenAI,
Anthropic, Ollama, Mistral, etc.) and any framework (LangChain, LlamaIndex, Vercel AI SDK, or raw
HTTP).

## The Problem

Most RAG tutorials show this pattern:

```typescript
const prompt = `Answer based on these sources:\n\n${context}\n\nQuestion: ${question}`;
```

This works for demos. It fails for compliance because:

1. **No source citation** — the model can't distinguish which chunk answered which part of the
   question
2. **No authority hierarchy** — a tier_3 best practice is weighted the same as a tier_1 regulatory
   mandate
3. **No refusal behavior** — the model guesses when the knowledge base doesn't have an answer
4. **No enforcement calibration** — without paired examples, the model drifts from rules over long
   conversations

## CFPO: Five Sections, Strict Order

CFPO structures every system prompt into five sections, always in this order:

```
┌─────────────────────────────────────────────┐
│  1. VOICE       — Who the AI is             │
│  2. MISSION     — What it must accomplish    │
│  3. RULES       — Constraints it must obey   │
│  4. ENFORCEMENT — ❌/✓ paired examples       │
│  5. OUTPUT      — Exact response format      │
└─────────────────────────────────────────────┘
```

The ordering matters. Models process system prompts sequentially — identity and mission context
established first reduces downstream rule violations. Enforcement examples near the end anchor
behavior right before generation begins.

### Why This Order?

| Position | Section         | Rationale                                                                                                                                            |
| -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| First    | **Voice**       | Establishes persona before any behavioral rules — the model "knows who it is" before being told what to do                                           |
| Second   | **Mission**     | Scopes the task — rules that follow are interpreted in this context, not in the abstract                                                             |
| Middle   | **Rules**       | Machine-parseable constraints. Placed after mission so the model understands _why_ the rules exist                                                   |
| Late     | **Enforcement** | Paired ❌/✓ examples are the highest-ROI calibration signal. Placed near the generation boundary so they're freshest in the model's attention window |
| Last     | **Output**      | Format contract. Last position = last thing the model "reads" before generating — reduces format drift                                               |

## Starter Template

Here's a complete CFPO system prompt for a compliance assistant backed by Panopticon chunks. Copy
this and adapt it.

````markdown
———————————————————————————————————————

## Voice — COMPLIANCE ASSISTANT

———————————————————————————————————————

You are a compliance knowledge assistant. You answer questions about regulatory requirements using
ONLY the retrieved context provided below. You do not have independent compliance knowledge — if the
context doesn't contain the answer, you say so.

You cite your sources by corpus ID and section title. You never present compliance guidance without
attribution.

———————————————————————————————————————

## Mission — GROUNDED REGULATORY Q&A

———————————————————————————————————————

Answer the user's compliance question using the retrieved corpus chunks. Your response must:

1. Be grounded in the provided context — no external knowledge
2. Cite the source corpus for every claim (corpus_id + section_title)
3. Distinguish between regulatory mandates (tier_1), industry standards (tier_2), and best practices
   (tier_3)
4. Refuse to answer when the context is insufficient

———————————————————————————————————————

## Rules — RETRIEVAL GROUNDING

———————————————————————————————————————

```yaml
grounding_policy:
  source: retrieved_corpus_chunks_only
  external_knowledge: prohibited
  citation_required: always
  citation_format: "[corpus_id § section_title]"

tier_authority:
  tier_1: "Regulatory mandate — MUST language"
  tier_2: "Industry standard — SHOULD language"
  tier_3: "Best practice — MAY / CONSIDER language"
  mixing: "When chunks from multiple tiers apply, present tier_1 first"

refusal_conditions:
  - no_relevant_chunks:
      "I don't have regulatory guidance on that topic in my current knowledge base."
  - low_similarity:
      "The available context may not directly address your question. Here's what I found, but verify
      with primary sources."
  - conflicting_chunks: "Present both positions with citations. Do not resolve the conflict."

metadata_usage:
  frameworks: "Use to scope answers (e.g., 'Under GDPR...' vs 'Under HIPAA...')"
  industries: "Use to contextualize when the user's industry is known"
  content_type: "boundary chunks define hard rules; prose chunks provide guidance"
```

———————————————————————————————————————

## Enforcement — GROUNDING EXAMPLES

———————————————————————————————————————

❌ VIOLATIONS:

- "Companies must notify within 72 hours" → Missing citation. Which regulation? Which corpus?
- "HIPAA requires encryption at rest" → Not grounded. This may be true but if no retrieved chunk
  says it, you cannot claim it.
- "Based on best practices, you must implement MFA" → Tier confusion. Best practices (tier_3) use
  MAY/CONSIDER, not "must."
- "I think the GDPR says..." → Hedging without citation. Either the context supports the claim (cite
  it) or it doesn't (refuse).

✓ VALID:

- "Under GDPR Article 33, organizations must notify the supervisory authority within 72 hours of
  becoming aware of a personal data breach [gdpr-core-v1 § Data Breach Notification]." → Grounded,
  cited, tier_1 MUST language.
- "SOC 2 Trust Services Criteria recommend implementing change management controls
  [soc2-controls-structured-v1 § Change Management]. This is an industry standard (tier_2), not a
  regulatory mandate." → Tier clearly identified.
- "I don't have specific guidance on PCI-DSS in my current knowledge base. The retrieved context
  covers GDPR and HIPAA but not payment card standards." → Honest refusal with explanation of what
  IS available.
- "Two frameworks address this differently: GDPR requires explicit consent [gdpr-core-v1 § Consent],
  while HIPAA permits processing under the Treatment, Payment, and Health Care Operations exception
  [healthcare-compliance-v1 § TPO Exception]. Check which framework applies to your use case." →
  Conflicting sources presented without resolution.

———————————————————————————————————————

## Output — RESPONSE FORMAT

———————————————————————————————————————

```yaml
response_format:
  structure:
    - answer: "Direct answer to the question, grounded in context"
    - citations: "Inline [corpus_id § section] references"
    - tier_note: "State the authority level when relevant"
    - caveats: "Flag when context is partial or multiple frameworks apply"

  prohibited:
    - Legal advice framing ("You should...", "Your organization must...")
    - Unattributed regulatory claims
    - Confidence scores or probability language
    - Advice beyond what the retrieved chunks support
```
````

## Injecting Retrieved Chunks

The system prompt above defines _behavior_. The retrieved chunks provide _knowledge_. Inject them as
a clearly delimited block in the user message or as a separate system message:

### Option A: Chunks in User Message (Recommended)

```typescript
import { createClient } from "@supabase/supabase-js";

const client = createClient(POSTGREST_URL, PIPELINE_ADMIN_KEY);

// 1. Embed the user's question
const queryEmbedding = await embedQuestion(userQuestion);

// 2. Retrieve attributed chunks
const { data: chunks } = await client.rpc("match_corpus_chunks_hybrid", {
  query_embedding: queryEmbedding,
  query_text: userQuestion,
  match_count: 8,
  semantic_weight: 0.7,
  filter_tier: "tier_1", // optional: only regulatory mandates
});

// 3. Format chunks with attribution metadata
const context = chunks
  .map(
    (c, i) =>
      `[Source ${i + 1}] corpus_id: ${c.corpus_id} | section: ${c.section_title} | tier: ${c.tier}\n${c.content}`,
  )
  .join("\n\n---\n\n");

// 4. Build the message array
const messages = [
  { role: "system", content: CFPO_SYSTEM_PROMPT },
  {
    role: "user",
    content: `## Retrieved Context\n\n${context}\n\n---\n\n## Question\n\n${userQuestion}`,
  },
];
```

### Option B: Chunks as a Separate System Message

Some models (Claude, GPT-4) handle multi-system-message formats. This separates behavior
instructions from knowledge:

```typescript
const messages = [
  { role: "system", content: CFPO_SYSTEM_PROMPT },
  { role: "system", content: `## Retrieved Corpus Chunks\n\n${context}` },
  { role: "user", content: userQuestion },
];
```

### Why Option A is Usually Better

- Works with every LLM API (some only support one system message)
- The `## Retrieved Context` / `## Question` delimiters make chunk boundaries unambiguous
- Models attend to user messages more consistently than to multiple system messages
- The system prompt stays cacheable (same across requests) while the user message varies

## Formatting Chunks for Maximum Retrieval Quality

How you format the injected chunks affects answer quality. Include the metadata — the model needs it
for citation and tier authority:

```typescript
function formatChunksForPrompt(chunks: CorpusChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const header = [
        `[Source ${i + 1}]`,
        `corpus_id: ${chunk.corpus_id}`,
        `section: ${chunk.section_title}`,
        `tier: ${chunk.tier}`,
        chunk.frameworks?.length ? `frameworks: ${chunk.frameworks.join(", ")}` : null,
        chunk.content_type ? `type: ${chunk.content_type}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      return `${header}\n${chunk.content}`;
    })
    .join("\n\n---\n\n");
}
```

### What to Include

| Field           | Include?           | Why                                                                                     |
| --------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `corpus_id`     | **Always**         | The model needs this to generate citations                                              |
| `section_title` | **Always**         | Enables `[corpus_id § section]` citation format                                         |
| `tier`          | **Always**         | Drives MUST/SHOULD/MAY language selection                                               |
| `content`       | **Always**         | The actual knowledge                                                                    |
| `frameworks`    | **When filtering** | Helps the model scope answers to the right regulation                                   |
| `content_type`  | **Sometimes**      | Useful when mixing prose, boundary, and structured chunks                               |
| `similarity`    | **No**             | The model doesn't need to know retrieval scores — it creates false confidence anchoring |
| `heading_path`  | **No**             | Redundant with section_title for most use cases                                         |

## Adapting CFPO for Your Use Case

The starter template is for a general compliance Q&A assistant. Here's how to adapt each section for
specific scenarios:

### Internal Policy Assistant

Change **Voice** to reference your organization. Change **Rules** to scope to internal corpora only:

```yaml
grounding_policy:
  source: retrieved_corpus_chunks_only
  scope: "internal policy documents only — do not reference external regulations"
  citation_format: "[policy_id § section]"

tier_authority:
  tier_1: "Board-approved policy — MUST comply"
  tier_2: "Department standard — SHOULD follow"
  tier_3: "Team guidance — RECOMMENDED"
```

### Multi-Jurisdiction Compliance

Add a jurisdiction rule to prevent cross-contamination:

```yaml
jurisdiction_policy:
  behavior: "Never apply one jurisdiction's rules to another"
  example: "GDPR consent requirements do not apply to US-only operations unless explicitly stated"
  user_jurisdiction: "{{USER_JURISDICTION}}" # injected at runtime
```

### Audit Preparation

Change **Output** to produce structured evidence:

```yaml
response_format:
  structure:
    - finding: "The specific compliance question or concern"
    - evidence: "Exact quotes from retrieved chunks with citations"
    - gap_analysis: "What the knowledge base covers vs. what's missing"
    - recommendation: "Next steps (always qualified as non-legal-advice)"
  format: markdown_with_tables
```

### Chatbot with Compliance Guardrails

If your AI assistant isn't _primarily_ a compliance tool but needs to respect regulatory boundaries,
use a lighter CFPO structure:

```yaml
grounding_policy:
  source: retrieved_corpus_chunks_when_relevant
  fallback:
    "Answer from general knowledge but flag when a compliance question would benefit from verified
    sources"
  citation_required: when_making_regulatory_claims
```

## Variable Injection

CFPO templates support `{{VARIABLE}}` placeholders that are resolved at runtime. This lets you reuse
one system prompt across contexts:

```typescript
const systemPrompt = compileCFPO(template, {
  ORGANIZATION_NAME: "Acme Corp",
  USER_JURISDICTION: "EU",
  ALLOWED_FRAMEWORKS: "GDPR, SOC 2",
  RESPONSE_LANGUAGE: "English",
});
```

Common variables:

| Variable                 | Purpose                                      | Example                          |
| ------------------------ | -------------------------------------------- | -------------------------------- |
| `{{ORGANIZATION_NAME}}`  | Personalize voice section                    | "Acme Corp Compliance Assistant" |
| `{{USER_JURISDICTION}}`  | Scope regulatory answers                     | "EU", "US-CA", "global"          |
| `{{ALLOWED_FRAMEWORKS}}` | Filter which frameworks the model references | "GDPR, HIPAA"                    |
| `{{RESPONSE_LANGUAGE}}`  | Multilingual support                         | "German", "Japanese"             |
| `{{CURRENT_DATE}}`       | Date-sensitive compliance questions          | "2026-02-25"                     |

## Full Working Example

End-to-end: retrieve chunks from Panopticon, inject them with CFPO, call OpenAI.

```typescript
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// ── Setup ──────────────────────────────────────────────────
const db = createClient(process.env.POSTGREST_URL!, process.env.PIPELINE_ADMIN_KEY!);
const openai = new OpenAI();

// ── CFPO System Prompt ─────────────────────────────────────
const SYSTEM_PROMPT = `You are a compliance knowledge assistant for {{ORG}}.

You answer questions using ONLY the retrieved corpus chunks below.
You cite every claim as [corpus_id § section_title].
You use MUST for tier_1, SHOULD for tier_2, MAY for tier_3.
You refuse when the context doesn't support an answer.

Do not provide legal advice. Do not hallucinate regulatory requirements.`.replace(
  "{{ORG}}",
  process.env.ORG_NAME ?? "your organization",
);

// ── Retrieve + Generate ────────────────────────────────────
async function answerComplianceQuestion(question: string): Promise<string> {
  // 1. Embed the question
  const embeddingRes = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: question,
    dimensions: 512,
  });
  const queryEmbedding = embeddingRes.data[0].embedding;

  // 2. Retrieve from Panopticon
  const { data: chunks } = await db.rpc("match_corpus_chunks_hybrid", {
    query_embedding: queryEmbedding,
    query_text: question,
    match_count: 8,
    semantic_weight: 0.7,
  });

  // 3. Format chunks with metadata
  const context = (chunks ?? [])
    .map(
      (c: any, i: number) =>
        `[Source ${i + 1}] ${c.corpus_id} § ${c.section_title} (tier: ${c.tier})\n${c.content}`,
    )
    .join("\n\n---\n\n");

  // 4. Generate with CFPO
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `## Retrieved Context\n\n${context}\n\n---\n\n## Question\n\n${question}`,
      },
    ],
    temperature: 0.1, // low temp for compliance accuracy
  });

  return completion.choices[0].message.content ?? "No response generated.";
}

// ── Usage ──────────────────────────────────────────────────
const answer = await answerComplianceQuestion(
  "What are the GDPR requirements for data breach notification?",
);
console.log(answer);
```

## Key Principles

1. **Separate behavior from knowledge.** The system prompt defines _how_ the model should behave.
   The retrieved chunks provide _what_ it knows. Never mix them.

2. **Always include metadata.** The model needs `corpus_id`, `section_title`, and `tier` to cite
   sources and calibrate authority language. Omitting metadata makes grounding impossible.

3. **Paired examples beat long instructions.** One ❌/✓ pair teaches a boundary more effectively
   than a paragraph of rules. Invest your token budget in enforcement examples.

4. **The last thing wins.** Models give disproportionate weight to the end of the system prompt and
   the end of the user message. Put your strictest constraint (output format) last. Put the user's
   question after the context, not before.

5. **Refuse rather than guess.** For compliance use cases, a confident wrong answer is worse than an
   honest "I don't know." Calibrate refusal behavior explicitly in the Rules section.

6. **Test with adversarial queries.** Try questions that are adjacent to but outside your knowledge
   base. Try questions that mix jurisdictions. Try questions that ask the model to provide legal
   advice. Your enforcement examples should handle all three.
