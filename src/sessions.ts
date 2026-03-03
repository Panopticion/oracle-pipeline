/**
 * Session management — multi-document parse batches with crosswalk generation.
 *
 * Sessions group multiple document uploads. Each document is AI-parsed and
 * reviewed individually, then a crosswalk is generated across all documents.
 * The final bundle (documents + crosswalk) can be downloaded.
 */

import { createHash } from "node:crypto";
import type {
  CorpusChunkRaw,
  CorpusSession,
  CreateSessionOptions,
  CrosswalkResult,
  GenerateCrosswalkOptions,
  SessionQualitySnapshotPayload,
  SessionDocument,
  SessionParseOptions,
  SessionParseResult,
  SupabaseClient,
} from "./types";
import { callOpenRouter } from "./openrouter";
import {
  buildParseSystemPrompt,
  buildParseUserMessage,
  buildFrontmatterOnlySystemPrompt,
  buildFrontmatterOnlyUserMessage,
} from "./prompts/parse-document";
import {
  buildChunkCleanseSystemPrompt,
  buildChunkCleanseUserPrompt,
} from "./prompts/cleanse-source-chunk";
import {
  buildCrosswalkSystemPrompt,
  buildCrosswalkUserMessage,
} from "./prompts/crosswalk-document";
import type { CrosswalkDocumentInput } from "./prompts/crosswalk-document";
import {
  chunkCorpus,
  chunkCrosswalkMarkdown,
  parseCorpusContent,
} from "./content-helpers";
import {
  injectWatermark,
  stripWatermark,
  verifyChunkWatermark,
} from "./watermark";
import { PARSE_MODEL_DEFAULT } from "./constants";
import {
  auditAndRecoverChunk,
  splitSourceTextIntoChunks,
  type ChunkAuditResult,
} from "./source-chunk-audit";

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function resolveSourceFilename(sourceFileName: string | undefined, sourceHash: string): string {
  const trimmed = sourceFileName?.trim();
  if (trimmed) return trimmed;
  return `upload-${sourceHash.slice(0, 8)}.txt`;
}

function extractMarkdown(raw: string): string {
  // Match opening ```markdown fence and extract everything up to the LAST ``` fence.
  // Greedy ([\s\S]*) ensures we don't stop at embedded code blocks in the body.
  const fenceMatch = raw.match(/```(?:markdown)?\s*\n([\s\S]*)\n\s*```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return raw.trim();
}

function extractMarkdownCandidates(raw: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: string | null | undefined) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  // 1) Existing strict extraction (single trailing fenced block or raw text).
  push(extractMarkdown(raw));

  // 2) Capture all fenced blocks anywhere in output (markdown/yaml/plain).
  const blockRegex = /```(?:markdown|md|yaml|yml)?\s*\n([\s\S]*?)\n\s*```/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(raw)) !== null) {
    push(match[1]);
  }

  // 3) If frontmatter appears mid-response, try slicing from first delimiter.
  const fmIndex = raw.search(/(^|\n)---\s*\n/);
  if (fmIndex >= 0) {
    const start = raw[fmIndex] === "-" ? fmIndex : fmIndex + 1;
    push(raw.slice(start));
  }

  // 4) Last resort: full raw trimmed response.
  push(raw);

  return candidates;
}

function selectValidCorpusMarkdown(raw: string): {
  markdown: string | null;
  parseError: string | null;
  fallback: string;
} {
  const candidates = extractMarkdownCandidates(raw);
  const fallback = candidates[0] ?? raw.trim();
  let lastError: string | null = null;

  for (const candidate of candidates) {
    try {
      parseCorpusContent(candidate);
      return { markdown: candidate, parseError: null, fallback };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    markdown: null,
    parseError: lastError ?? "Unknown parse validation error",
    fallback,
  };
}

const CHUNK_STRATEGY = "hybrid_paragraph_cap";

interface ChunkAuditPipelineResult {
  recoveredSourceText: string;
  sourceChunkCount: number;
  omissionChunkCount: number;
  recoveredChunkCount: number;
  auditWarnings: string[];
  inputTokens: number;
  outputTokens: number;
}

const DETERMINISTIC_PARSE_WORD_THRESHOLD = Number.parseInt(
  process.env.DETERMINISTIC_PARSE_WORD_THRESHOLD ?? "50000",
  10,
);

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function toKebabCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferTitle(sourceFileName: string | undefined, sourceText: string): string {
  const fromFile = sourceFileName?.trim();
  if (fromFile) {
    const noExt = fromFile.replace(/\.[a-z0-9]+$/i, "");
    const normalized = noExt.replace(/[_-]+/g, " ").trim();
    if (normalized) return toTitleCase(normalized);
  }

  const firstLine = sourceText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (firstLine) {
    return firstLine.slice(0, 120);
  }

  return "Compliance Document";
}

function buildDeterministicSections(sourceText: string): string {
  const paragraphs = sourceText
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "## Section 1\n\nNo content extracted.";
  }

  const targetWords = 1200;
  const sections: string[] = [];
  let bucket: string[] = [];
  let bucketWords = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    const idx = sections.length + 1;
    const preview = bucket[0].replace(/^#+\s+/, "").slice(0, 80).trim();
    const title = preview ? `Section ${String(idx)} — ${preview}` : `Section ${String(idx)}`;
    sections.push(`## ${title}\n\n${bucket.join("\n\n")}`);
    bucket = [];
    bucketWords = 0;
  };

  for (const paragraph of paragraphs) {
    const paraWords = wordCount(paragraph);

    if (bucketWords > 0 && bucketWords + paraWords > targetWords) {
      flush();
    }

    bucket.push(paragraph);
    bucketWords += paraWords;
  }

  flush();

  return sections.join("\n\n");
}

function buildDeterministicCorpusMarkdown(params: {
  sourceText: string;
  sourceFileName?: string;
  hints?: SessionParseOptions["hints"];
}): string {
  const title = inferTitle(params.sourceFileName, params.sourceText);
  const hash = sha256(`${title}\n${params.sourceText}`).slice(0, 8);
  const slugBase = toKebabCase(title) || `document-${hash}`;
  const corpusId = `${slugBase}-${hash}-v1`;
  const today = new Date().toISOString().slice(0, 10);
  const tier = params.hints?.tier && /^tier_[123]$/.test(params.hints.tier)
    ? params.hints.tier
    : "tier_2";
  const frameworks = (params.hints?.frameworks ?? []).filter(Boolean);
  const industries = (params.hints?.industries ?? []).filter(Boolean);
  const sourcePublisher = params.hints?.sourcePublisher?.trim() || "Unknown";
  const sourceUrl = params.hints?.sourceUrl?.trim() || "unknown";

  const body = buildDeterministicSections(params.sourceText);

  const markdown = `---
corpus_id: ${corpusId}
title: ${title}
tier: ${tier}
version: 1
frameworks: [${frameworks.join(", ")}]
industries: [${industries.join(", ")}]
source_url: ${sourceUrl}
source_publisher: ${sourcePublisher}
last_verified: ${today}
language: english
fact_check:
  status: ai_parsed
  checked_at: "${today}"
  checked_by: deterministic-assembler-v1
sire:
  subject: compliance
  included: [regulation, control, requirement]
  excluded: []
  relevant: []
---

${body}`;

  parseCorpusContent(markdown);
  return markdown;
}

function isMissingAuditTableError(error: {
  code?: string;
  message?: string;
} | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("could not find the table") ||
    message.includes("schema cache") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

async function persistSourceChunks(
  client: SupabaseClient,
  documentId: string,
  chunks: ReturnType<typeof splitSourceTextIntoChunks>,
): Promise<void> {
  const { error: deleteError } = await client
    .from("corpus_document_source_chunks")
    .delete()
    .eq("document_id", documentId);

  if (deleteError) {
    if (isMissingAuditTableError(deleteError)) {
      console.warn("[corpus-pipeline] source chunk table missing; skipping persistence");
      return;
    }
    throw new Error(`Failed clearing source chunks: ${deleteError.message}`);
  }

  if (chunks.length === 0) return;

  const { error: insertError } = await client
    .from("corpus_document_source_chunks")
    .insert(
      chunks.map((chunk) => ({
        document_id: documentId,
        sequence: chunk.sequence,
        source_text: chunk.sourceText,
        source_hash: chunk.sourceHash,
        chunk_strategy: CHUNK_STRATEGY,
      })),
    );

  if (insertError) {
    if (isMissingAuditTableError(insertError)) {
      console.warn("[corpus-pipeline] source chunk table missing; skipping persistence");
      return;
    }
    throw new Error(`Failed storing source chunks: ${insertError.message}`);
  }
}

async function persistChunkAudits(
  client: SupabaseClient,
  documentId: string,
  audits: ChunkAuditResult[],
): Promise<void> {
  const { error: deleteError } = await client
    .from("corpus_document_chunk_audits")
    .delete()
    .eq("document_id", documentId);

  if (deleteError) {
    if (isMissingAuditTableError(deleteError)) {
      console.warn("[corpus-pipeline] chunk audit table missing; skipping persistence");
      return;
    }
    throw new Error(`Failed clearing chunk audits: ${deleteError.message}`);
  }

  if (audits.length === 0) return;

  const { error: insertError } = await client
    .from("corpus_document_chunk_audits")
    .insert(
      audits.map((audit) => ({
        document_id: documentId,
        sequence: audit.sequence,
        source_hash: audit.sourceHash,
        ai_hash: audit.aiHash,
        coverage_ratio: audit.coverageRatio,
        omission_detected: audit.omissionDetected,
        recovered_from_source: audit.recoveredFromSource,
        source_text: audit.sourceText,
        ai_text: audit.aiText,
        recovered_text: audit.recoveredText,
        warnings: audit.warnings,
      })),
    );

  if (insertError) {
    if (isMissingAuditTableError(insertError)) {
      console.warn("[corpus-pipeline] chunk audit table missing; skipping persistence");
      return;
    }
    throw new Error(`Failed storing chunk audits: ${insertError.message}`);
  }
}

async function runChunkAuditPipeline(
  client: SupabaseClient,
  documentId: string,
  sourceText: string,
  options: SessionParseOptions,
  model: string,
): Promise<ChunkAuditPipelineResult> {
  const sourceChunks = splitSourceTextIntoChunks(sourceText);
  await options.onProgress?.({
    step: "chunk_audit",
    message: `Preparing chunk audit (${String(sourceChunks.length)} chunk${sourceChunks.length === 1 ? "" : "s"})`,
    details: {
      totalChunks: sourceChunks.length,
    },
  });
  await persistSourceChunks(client, documentId, sourceChunks);

  const cleanseSystemPrompt = buildChunkCleanseSystemPrompt();
  const audits: ChunkAuditResult[] = [];
  let cleanseInputTokens = 0;
  let cleanseOutputTokens = 0;

  for (const chunk of sourceChunks) {
    await options.onProgress?.({
      step: "chunk_audit",
      message: `Cleaning source chunk ${String(chunk.sequence)}/${String(sourceChunks.length)}`,
      details: {
        chunkSequence: chunk.sequence,
        totalChunks: sourceChunks.length,
      },
    });

    const cleanseResult = await callOpenRouter(
      [
        { role: "system", content: cleanseSystemPrompt },
        {
          role: "user",
          content: buildChunkCleanseUserPrompt(chunk.sourceText, chunk.sequence),
        },
      ],
      {
        apiKey: options.openrouterApiKey,
        model,
        temperature: 0,
        maxTokens: 8_192,
      },
    );

    cleanseInputTokens += cleanseResult.inputTokens;
    cleanseOutputTokens += cleanseResult.outputTokens;

    const cleanseText = extractMarkdown(cleanseResult.content);
    audits.push(auditAndRecoverChunk(chunk, cleanseText));
  }

  await persistChunkAudits(client, documentId, audits);

  await options.onProgress?.({
    step: "chunk_audit",
    message: "Chunk audit complete",
    details: {
      omissionChunkCount: audits.filter((audit) => audit.omissionDetected).length,
      recoveredChunkCount: audits.filter((audit) => audit.recoveredFromSource).length,
    },
  });

  return {
    recoveredSourceText: audits.map((audit) => audit.recoveredText).join("\n\n"),
    sourceChunkCount: sourceChunks.length,
    omissionChunkCount: audits.filter((audit) => audit.omissionDetected).length,
    recoveredChunkCount: audits.filter((audit) => audit.recoveredFromSource).length,
    auditWarnings: audits.flatMap((audit) =>
      audit.warnings.map((warning) => `chunk_${String(audit.sequence)}:${warning}`),
    ),
    inputTokens: cleanseInputTokens,
    outputTokens: cleanseOutputTokens,
  };
}

async function parseDocumentWithAudit(
  client: SupabaseClient,
  documentId: string,
  sourceText: string,
  sourceFileName: string | undefined,
  options: SessionParseOptions,
  model: string,
): Promise<SessionParseResult> {
  // ─── Firecrawl-prepped path: AI generates frontmatter only ──────────────
  if (options.parsePromptProfile === "firecrawl_prepped") {
    return parseFirecrawlPrepped(client, documentId, sourceText, sourceFileName, options, model);
  }

  // ─── Standard path: chunk audit → AI full parse ─────────────────────────
  await options.onProgress?.({
    step: "chunk_audit",
    message: "Running chunk audit and source cleanup",
  });

  const chunkAudit = await runChunkAuditPipeline(
    client,
    documentId,
    sourceText,
    options,
    model,
  );

  const systemPrompt = buildParseSystemPrompt(model, {
    ...(options.hints ?? {}),
    parsePromptProfile: options.parsePromptProfile,
  });

  const recoveredWordCount = wordCount(chunkAudit.recoveredSourceText);
  if (recoveredWordCount >= DETERMINISTIC_PARSE_WORD_THRESHOLD) {
    await options.onProgress?.({
      step: "parse",
      message: "Large document detected — using deterministic assembly",
      details: {
        recoveredWordCount,
        threshold: DETERMINISTIC_PARSE_WORD_THRESHOLD,
      },
    });

    const deterministicMarkdown = buildDeterministicCorpusMarkdown({
      sourceText: chunkAudit.recoveredSourceText,
      sourceFileName,
      hints: options.hints,
    });

    return {
      documentId,
      parsedMarkdown: deterministicMarkdown,
      model: "deterministic-assembler-v1",
      inputTokens: chunkAudit.inputTokens,
      outputTokens: chunkAudit.outputTokens,
      totalSourceChunks: chunkAudit.sourceChunkCount,
      omissionChunkCount: chunkAudit.omissionChunkCount,
      recoveredChunkCount: chunkAudit.recoveredChunkCount,
      auditWarnings: chunkAudit.auditWarnings,
    };
  }

  const userMessage = buildParseUserMessage(
    chunkAudit.recoveredSourceText,
    sourceFileName,
  );

  await options.onProgress?.({
    step: "parse",
    message: "Generating structured corpus markdown",
  });

  const parseResult = await callOpenRouter(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    {
      apiKey: options.openrouterApiKey,
      model,
    },
  );

  const selected = selectValidCorpusMarkdown(parseResult.content);
  if (!selected.markdown) {
    const msg = selected.parseError ?? "Unknown parse validation error";

    await client
      .from("corpus_session_documents")
      .update({
        status: "failed",
        error_message: `AI output failed validation: ${msg}`,
        parsed_markdown: selected.fallback,
        parse_tokens_in: parseResult.inputTokens + chunkAudit.inputTokens,
        parse_tokens_out: parseResult.outputTokens + chunkAudit.outputTokens,
      })
      .eq("id", documentId);

    throw new Error(`AI produced invalid corpus Markdown: ${msg}`);
  }

  return {
    documentId,
    parsedMarkdown: selected.markdown,
    model: parseResult.model,
    inputTokens: parseResult.inputTokens + chunkAudit.inputTokens,
    outputTokens: parseResult.outputTokens + chunkAudit.outputTokens,
    totalSourceChunks: chunkAudit.sourceChunkCount,
    omissionChunkCount: chunkAudit.omissionChunkCount,
    recoveredChunkCount: chunkAudit.recoveredChunkCount,
    auditWarnings: chunkAudit.auditWarnings,
  };
}

/**
 * Firecrawl-prepped parse: body is already clean markdown from Firecrawl.
 * AI generates ONLY the YAML frontmatter, which is combined with the body.
 * Skips chunk audit entirely — no need to clean already-clean text.
 */
async function parseFirecrawlPrepped(
  client: SupabaseClient,
  documentId: string,
  sourceText: string,
  sourceFileName: string | undefined,
  options: SessionParseOptions,
  model: string,
): Promise<SessionParseResult> {
  await options.onProgress?.({
    step: "parse",
    message: "Firecrawl-prepped — generating frontmatter only",
  });

  const systemPrompt = buildFrontmatterOnlySystemPrompt(model, options.hints);
  const userMessage = buildFrontmatterOnlyUserMessage(sourceText, sourceFileName);

  const parseResult = await callOpenRouter(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    {
      apiKey: options.openrouterApiKey,
      model,
    },
  );

  // Extract frontmatter from AI response
  const frontmatter = extractFrontmatterBlock(parseResult.content);
  if (!frontmatter) {
    await client
      .from("corpus_session_documents")
      .update({
        status: "failed",
        error_message: "AI failed to produce valid YAML frontmatter",
        parsed_markdown: parseResult.content,
        parse_tokens_in: parseResult.inputTokens,
        parse_tokens_out: parseResult.outputTokens,
      })
      .eq("id", documentId);

    throw new Error("AI produced invalid frontmatter for Firecrawl-prepped document");
  }

  // Combine: AI frontmatter + Firecrawl body
  const combined = `${frontmatter}\n\n${sourceText}`;

  // Validate the combined document
  const selected = selectValidCorpusMarkdown(combined);
  if (!selected.markdown) {
    const msg = selected.parseError ?? "Combined document failed validation";

    await client
      .from("corpus_session_documents")
      .update({
        status: "failed",
        error_message: `Firecrawl-prepped parse failed validation: ${msg}`,
        parsed_markdown: combined,
        parse_tokens_in: parseResult.inputTokens,
        parse_tokens_out: parseResult.outputTokens,
      })
      .eq("id", documentId);

    throw new Error(`Firecrawl-prepped parse failed: ${msg}`);
  }

  return {
    documentId,
    parsedMarkdown: selected.markdown,
    model: parseResult.model,
    inputTokens: parseResult.inputTokens,
    outputTokens: parseResult.outputTokens,
    totalSourceChunks: 0,
    omissionChunkCount: 0,
    recoveredChunkCount: 0,
    auditWarnings: [],
  };
}

/**
 * Extract the YAML frontmatter block (---\n...\n---) from AI output.
 * Returns the full block including delimiters, or null if not found.
 */
function extractFrontmatterBlock(raw: string): string | null {
  const trimmed = raw.trim();
  // Try direct extraction
  const match = trimmed.match(/^---\r?\n[\s\S]*?\n---/);
  if (match) return match[0];

  // Try extracting from code fences
  const fenced = trimmed.match(/```(?:ya?ml)?\s*\n(---\r?\n[\s\S]*?\n---)\s*\n```/);
  if (fenced) return fenced[1];

  return null;
}

// ─── Session CRUD ───────────────────────────────────────────────────────────

/**
 * Create a new parse session.
 */
export async function createSession(
  client: SupabaseClient,
  options: CreateSessionOptions = {},
): Promise<CorpusSession> {
  const { data, error } = await client
    .from("corpus_parse_sessions")
    .insert({
      name: options.name ?? "Untitled Session",
      organization_id: options.organizationId ?? null,
      created_by: options.userId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return data as CorpusSession;
}

/**
 * Get a session by ID.
 */
export async function getSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<CorpusSession> {
  const { data, error } = await client
    .from("corpus_parse_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return data as CorpusSession;
}

/**
 * List all sessions for an organization.
 */
export async function listSessions(
  client: SupabaseClient,
  organizationId?: string,
): Promise<CorpusSession[]> {
  let query = client
    .from("corpus_parse_sessions")
    .select("*")
    .order("created_at", { ascending: false });

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list sessions: ${error.message}`);
  }

  return (data ?? []) as CorpusSession[];
}

/**
 * Update session name.
 */
export async function updateSessionName(
  client: SupabaseClient,
  sessionId: string,
  name: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ name })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to update session name: ${error.message}`);
  }
}

/**
 * Set a session's public visibility.
 */
export async function setSessionPublic(
  client: SupabaseClient,
  sessionId: string,
  isPublic: boolean,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ is_public: isPublic })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to update session visibility: ${error.message}`);
  }
}

/**
 * Delete a session (cascades to all documents).
 */
export async function deleteSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to delete session: ${error.message}`);
  }
}

// ─── Session Documents ──────────────────────────────────────────────────────

/**
 * Get all documents in a session.
 */
export async function getSessionDocuments(
  client: SupabaseClient,
  sessionId: string,
): Promise<SessionDocument[]> {
  const { data, error } = await client
    .from("corpus_session_documents")
    .select("*")
    .eq("session_id", sessionId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to get session documents: ${error.message}`);
  }

  const docs = (data ?? []) as SessionDocument[];
  if (docs.length === 0) {
    return docs;
  }

  const docIds = docs.map((doc) => doc.id);
  const warningMeta = new Map<string, { count: number; preview: string[] }>();

  const { data: auditRows, error: auditError } = await client
    .from("corpus_document_chunk_audits")
    .select("document_id, warnings, omission_detected")
    .in("document_id", docIds)
    .eq("omission_detected", true)
    .order("sequence", { ascending: true });

  if (auditError && !isMissingAuditTableError(auditError)) {
    throw new Error(`Failed to load chunk audit warnings: ${auditError.message}`);
  }

  for (const row of (auditRows ?? []) as Array<{
    document_id: string;
    warnings: string[] | null;
    omission_detected: boolean;
  }>) {
    if (!row.omission_detected) continue;

    const existing = warningMeta.get(row.document_id) ?? { count: 0, preview: [] };
    const rowWarnings = (row.warnings ?? []).filter(Boolean);
    const warningCount = rowWarnings.length > 0 ? rowWarnings.length : 1;
    const preview = [...existing.preview, ...rowWarnings].slice(0, 3);

    warningMeta.set(row.document_id, {
      count: existing.count + warningCount,
      preview,
    });
  }

  const parseJobByDocumentId = new Map<string, {
    id: number;
    status: "pending" | "in_progress" | "done" | "failed";
    retry_count: number;
    max_retries: number;
    updated_at: string;
    error: string | null;
    step?: string | null;
    message?: string | null;
  }>();

  const jobFetchLimit = Math.max(200, docIds.length * 8);
  const { data: parseJobs, error: parseJobsError } = await client
    .from("corpus_jobs")
    .select("id, payload, status, retry_count, max_retries, updated_at, error, result")
    .eq("kind", "parse_document")
    .order("id", { ascending: false })
    .limit(jobFetchLimit);

  if (parseJobsError) {
    throw new Error(`Failed to load parse jobs: ${parseJobsError.message}`);
  }

  const remainingDocIds = new Set(docIds);
  for (const row of (parseJobs ?? []) as Array<{
    id: number;
    payload: Record<string, unknown> | null;
    status: "pending" | "in_progress" | "done" | "failed";
    retry_count: number;
    max_retries: number;
    updated_at: string;
    error: string | null;
    result: Record<string, unknown> | null;
  }>) {
    const documentId = typeof row.payload?.documentId === "string"
      ? row.payload.documentId
      : null;

    if (!documentId || !remainingDocIds.has(documentId)) continue;

    const step = typeof row.result?.step === "string" ? row.result.step : null;
    const message = typeof row.result?.message === "string" ? row.result.message : null;

    parseJobByDocumentId.set(documentId, {
      id: row.id,
      status: row.status,
      retry_count: row.retry_count,
      max_retries: row.max_retries,
      updated_at: row.updated_at,
      error: row.error,
      step,
      message,
    });

    remainingDocIds.delete(documentId);
    if (remainingDocIds.size === 0) break;
  }

  return docs.map((doc) => {
    const meta = warningMeta.get(doc.id);
    return {
      ...doc,
      audit_warning_count: meta?.count ?? 0,
      audit_warning_preview: meta?.preview ?? [],
      parse_job: parseJobByDocumentId.get(doc.id) ?? null,
    };
  });
}

/**
 * Insert a document row for parsing (no AI call yet).
 *
 * Returns the new document ID immediately so the client can show a
 * "parsing" card. Follow up with reparseDocument() to trigger the
 * actual AI parse.
 */
export async function insertDocumentForParse(
  client: SupabaseClient,
  sessionId: string,
  sourceText: string,
  options: {
    sourceFileName?: string;
    userId?: string;
    organizationId?: string;
    model?: string;
  },
): Promise<{
  documentId: string;
  sourceHash: string;
  sortOrder: number;
  isDuplicate: boolean;
}> {
  const model = options.model ?? PARSE_MODEL_DEFAULT;
  const sourceHash = sha256(sourceText);
  const sourceFilename = resolveSourceFilename(options.sourceFileName, sourceHash);

  const { count } = await client
    .from("corpus_session_documents")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId);

  const { data, error: insertError } = await client
    .from("corpus_session_documents")
    .insert({
      session_id: sessionId,
      source_filename: sourceFilename,
      source_text: sourceText,
      source_hash: sourceHash,
      status: "parsing",
      parse_model: model,
      organization_id: options.organizationId ?? null,
      created_by: options.userId ?? null,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: existing, error: existingError } = await client
        .from("corpus_session_documents")
        .select("id, sort_order")
        .eq("session_id", sessionId)
        .eq("source_hash", sourceHash)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError || !existing) {
        throw new Error(
          `Document already uploaded to this session (duplicate source hash: ${sourceHash.slice(0, 12)}...)`,
        );
      }

      return {
        documentId: existing.id as string,
        sourceHash,
        sortOrder: (existing.sort_order as number) ?? 0,
        isDuplicate: true,
      };
    }
    throw new Error(`Failed to add document: ${insertError.message}`);
  }

  return {
    documentId: data.id as string,
    sourceHash,
    sortOrder: count ?? 0,
    isDuplicate: false,
  };
}

/**
 * Add a document to a session and parse it with AI.
 *
 * 1. Inserts a document row with status 'parsing'
 * 2. Calls OpenRouter with the CFPO parse prompt
 * 3. Updates the document with the parsed result
 */
export async function addAndParseDocument(
  client: SupabaseClient,
  sessionId: string,
  sourceText: string,
  options: SessionParseOptions,
): Promise<SessionParseResult> {
  const model = options.model ?? PARSE_MODEL_DEFAULT;
  const sourceHash = sha256(sourceText);
  const sourceFilename = resolveSourceFilename(options.sourceFileName, sourceHash);

  // Get current document count for sort order
  const { count } = await client
    .from("corpus_session_documents")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId);

  // Insert document row
  const { data, error: insertError } = await client
    .from("corpus_session_documents")
    .insert({
      session_id: sessionId,
      source_filename: sourceFilename,
      source_text: sourceText,
      source_hash: sourceHash,
      status: "parsing",
      parse_model: model,
      organization_id: options.organizationId ?? null,
      created_by: options.userId ?? null,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      throw new Error(
        `Document already uploaded to this session (duplicate source hash: ${sourceHash.slice(0, 12)}...)`,
      );
    }
    throw new Error(`Failed to add document: ${insertError.message}`);
  }

  const documentId = data.id as string;

  // Parse with chunk-first audit + recovery pipeline
  try {
    const parse = await parseDocumentWithAudit(
      client,
      documentId,
      sourceText,
      options.sourceFileName,
      options,
      model,
    );

    // Update document with parsed result
    await client
      .from("corpus_session_documents")
      .update({
        parsed_markdown: parse.parsedMarkdown,
        parse_tokens_in: parse.inputTokens,
        parse_tokens_out: parse.outputTokens,
        status: "parsed",
      })
      .eq("id", documentId);

    return parse;
  } catch (err) {
    // Mark document as failed
    const msg = err instanceof Error ? err.message : String(err);
    await client
      .from("corpus_session_documents")
      .update({
        status: "failed",
        error_message: `Parse failed: ${msg}`,
      })
      .eq("id", documentId);

    throw err;
  }
}

/**
 * Re-parse a document that failed or needs re-parsing.
 */
export async function reparseDocument(
  client: SupabaseClient,
  documentId: string,
  options: SessionParseOptions,
): Promise<SessionParseResult> {
  // Fetch existing document
  const { data: doc, error } = await client
    .from("corpus_session_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const model = options.model ?? PARSE_MODEL_DEFAULT;

  // Update status to parsing
  await client
    .from("corpus_session_documents")
    .update({ status: "parsing", error_message: null, parse_model: model })
    .eq("id", documentId);

  await options.onProgress?.({
    step: "queued",
    message: "Parse queued",
  });

  // Parse with chunk-first audit + recovery pipeline
  try {
    const parse = await parseDocumentWithAudit(
      client,
      documentId,
      doc.source_text as string,
      (doc.source_filename as string) ?? options.sourceFileName,
      options,
      model,
    );

    // Update with result
    await options.onProgress?.({
      step: "persist",
      message: "Saving parsed output",
    });

    await client
      .from("corpus_session_documents")
      .update({
        parsed_markdown: parse.parsedMarkdown,
        parse_tokens_in: parse.inputTokens,
        parse_tokens_out: parse.outputTokens,
        status: "parsed",
        user_markdown: null, // Clear previous edits
      })
      .eq("id", documentId)
      .eq("status", "parsing");

    await options.onProgress?.({
      step: "completed",
      message: "Parse completed",
    });

    return parse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await client
      .from("corpus_session_documents")
      .update({
        status: "failed",
        error_message: `Re-parse failed: ${msg}`,
      })
      .eq("id", documentId)
      .eq("status", "parsing");

    throw err;
  }
}

/**
 * Save user edits to a document's parsed markdown.
 */
export async function saveDocumentEdit(
  client: SupabaseClient,
  documentId: string,
  userMarkdown: string,
): Promise<void> {
  parseCorpusContent(userMarkdown);

  const { error } = await client
    .from("corpus_session_documents")
    .update({
      user_markdown: userMarkdown,
      status: "edited",
    })
    .eq("id", documentId);

  if (error) {
    throw new Error(`Failed to save edit: ${error.message}`);
  }
}

/**
 * Delete a document from a session.
 */
export async function deleteDocument(
  client: SupabaseClient,
  documentId: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_session_documents")
    .delete()
    .eq("id", documentId);

  if (error) {
    throw new Error(`Failed to delete document: ${error.message}`);
  }
}

// ─── Chunk & Watermark ──────────────────────────────────────────────────────

/**
 * Chunk a parsed/edited document into semantic sections.
 *
 * Reads user_markdown (if edited) or parsed_markdown, parses frontmatter,
 * runs chunkCorpus() to split on H2/H3 boundaries, and stores the result
 * in chunks_json. Sets status to 'chunked'.
 */
export async function chunkDocument(
  client: SupabaseClient,
  documentId: string,
): Promise<{ documentId: string; chunkCount: number; chunks: CorpusChunkRaw[] }> {
  const { data: doc, error } = await client
    .from("corpus_session_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const markdown = (doc.user_markdown ?? doc.parsed_markdown ?? "") as string;
  if (!markdown.trim()) {
    throw new Error("Document has no parsed content to chunk");
  }

  // Parse frontmatter + body into a Corpus object
  const corpus = parseCorpusContent(markdown);
  const chunks = chunkCorpus(corpus).map((chunk, index) => {
    const normalizedContent = stripWatermark(chunk.content);
    return {
      ...chunk,
      sequence: index,
      content: normalizedContent,
      content_hash: sha256(normalizedContent),
    };
  });

  // Store chunks and update status
  const { error: updateError } = await client
    .from("corpus_session_documents")
    .update({
      chunks_json: chunks,
      status: "chunked",
    })
    .eq("id", documentId);

  if (updateError) {
    throw new Error(`Failed to save chunks: ${updateError.message}`);
  }

  return { documentId, chunkCount: chunks.length, chunks };
}

/**
 * Watermark all chunks in a chunked document.
 *
 * Reads chunks_json, extracts the corpus_id from the document's markdown
 * frontmatter, and injects a provenance watermark into each chunk's content.
 * Updates chunks_json in-place and sets status to 'watermarked'.
 */
export async function watermarkDocument(
  client: SupabaseClient,
  documentId: string,
): Promise<{ documentId: string; chunkCount: number; chunks: CorpusChunkRaw[] }> {
  const { data: doc, error } = await client
    .from("corpus_session_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const chunks = doc.chunks_json as CorpusChunkRaw[] | null;
  if (!chunks || chunks.length === 0) {
    throw new Error("Document has no chunks — run chunkDocument first");
  }

  // Extract corpus_id from frontmatter
  const markdown = (doc.user_markdown ?? doc.parsed_markdown ?? "") as string;
  const corpus = parseCorpusContent(markdown);
  const corpusId = corpus.corpus_id;

  // Watermark each chunk
  const watermarkedChunks: CorpusChunkRaw[] = chunks.map((chunk, index) => {
    const normalizedContent = stripWatermark(chunk.content);
    const normalizedHash = sha256(normalizedContent);
    const sequence = Number.isInteger(chunk.sequence) ? chunk.sequence : index;

    const watermarkedContent = injectWatermark(normalizedContent, {
      corpusId,
      sequence,
      contentHash: normalizedHash,
    });

    const verification = verifyChunkWatermark(watermarkedContent);
    if (!verification.valid || !verification.payload) {
      throw new Error(
        `Watermark integrity check failed for chunk sequence ${String(sequence)}: ${verification.reason ?? "verification failed"}`,
      );
    }
    if (verification.payload.corpusId !== corpusId || verification.payload.sequence !== sequence) {
      throw new Error(
        `Watermark payload mismatch for chunk sequence ${String(sequence)} (expected corpus_id=${corpusId})`,
      );
    }

    return {
      ...chunk,
      sequence,
      content: watermarkedContent,
      content_hash: normalizedHash,
    };
  });

  // Update chunks and status
  const { error: updateError } = await client
    .from("corpus_session_documents")
    .update({
      chunks_json: watermarkedChunks,
      status: "watermarked",
    })
    .eq("id", documentId);

  if (updateError) {
    throw new Error(`Failed to save watermarked chunks: ${updateError.message}`);
  }

  return { documentId, chunkCount: watermarkedChunks.length, chunks: watermarkedChunks };
}

// ─── Session Status ─────────────────────────────────────────────────────────

/**
 * Mark a session as complete (all documents parsed/edited, ready for crosswalk).
 */
export async function markSessionComplete(
  client: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ status: "complete" })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to mark session complete: ${error.message}`);
  }
}

/**
 * Archive a session.
 */
export async function archiveSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ status: "archived" })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to archive session: ${error.message}`);
  }
}

// ─── Quality Snapshots ───────────────────────────────────────────────────────

export async function recordSessionQualitySnapshot(
  client: SupabaseClient,
  sessionId: string,
  metrics: SessionQualitySnapshotPayload,
  userId?: string,
): Promise<{ inserted: boolean }> {
  const { data: session, error: sessionErr } = await client
    .from("corpus_parse_sessions")
    .select("id, organization_id, created_by")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const metricsJson = JSON.stringify(metrics);
  const metricsHash = sha256(metricsJson);

  const { data: latest, error: latestErr } = await client
    .from("corpus_session_quality_snapshots")
    .select("metrics_hash")
    .eq("session_id", sessionId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    throw new Error(`Failed to read latest quality snapshot: ${latestErr.message}`);
  }

  if (latest?.metrics_hash === metricsHash) {
    return { inserted: false };
  }

  const { error: insertErr } = await client
    .from("corpus_session_quality_snapshots")
    .insert({
      session_id: sessionId,
      organization_id: (session.organization_id as string | null) ?? null,
      created_by: userId ?? (session.created_by as string | null) ?? null,
      metrics_json: metrics,
      metrics_hash: metricsHash,
    });

  if (insertErr) {
    throw new Error(`Failed to insert quality snapshot: ${insertErr.message}`);
  }

  return { inserted: true };
}

// ─── Crosswalk Generation ───────────────────────────────────────────────────

/**
 * Generate a crosswalk mapping across all documents in a session.
 *
 * 1. Fetches all parsed/edited documents
 * 2. Extracts frontmatter metadata from each
 * 3. Calls OpenRouter with the crosswalk CFPO prompt
 * 4. Stores the result on the session
 */
export async function generateCrosswalk(
  client: SupabaseClient,
  sessionId: string,
  options: GenerateCrosswalkOptions,
): Promise<CrosswalkResult> {
  const model = options.model ?? PARSE_MODEL_DEFAULT;

  // Update session status
  await client
    .from("corpus_parse_sessions")
    .update({ status: "crosswalk_pending" })
    .eq("id", sessionId);

  // Fetch all documents
  const docs = await getSessionDocuments(client, sessionId);

  // Crosswalk is an expensive operation. Require quality gates:
  // 1) document must be watermarked
  // 2) document must be promoted to Encyclopedia
  const promotedWatermarkedDocs = docs.filter(
    (d) => d.status === "watermarked" && Boolean(d.promoted_at),
  );

  if (promotedWatermarkedDocs.length < 2) {
    await client
      .from("corpus_parse_sessions")
      .update({ status: "complete" })
      .eq("id", sessionId);

    const watermarkedCount = docs.filter((d) => d.status === "watermarked").length;
    const promotedCount = docs.filter((d) => Boolean(d.promoted_at)).length;

    throw new Error(
      `Need at least 2 promoted + watermarked documents to generate a crosswalk (watermarked=${String(watermarkedCount)}, promoted=${String(promotedCount)}, promoted_and_watermarked=${String(promotedWatermarkedDocs.length)}).`,
    );
  }

  // Build crosswalk inputs from promoted + watermarked documents only
  const crosswalkInputs: CrosswalkDocumentInput[] = promotedWatermarkedDocs.map((doc) => {
    const markdown = doc.user_markdown ?? doc.parsed_markdown ?? "";

    // Extract metadata from frontmatter
    let corpusId = "unknown";
    let title = doc.source_filename;
    let tier = "tier_3";
    let frameworks: string[] = [];

    try {
      const corpus = parseCorpusContent(markdown);
      corpusId = corpus.corpus_id;
      title = corpus.title;
      tier = corpus.tier;
      frameworks = corpus.frameworks;
    } catch {
      // Use defaults if parsing fails
    }

    return { corpusId, title, tier, frameworks, markdown };
  });

  // Call OpenRouter
  try {
    const systemPrompt = buildCrosswalkSystemPrompt(model);
    const userMessage = buildCrosswalkUserMessage(crosswalkInputs);

    const result = await callOpenRouter(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        apiKey: options.openrouterApiKey,
        model,
      },
    );

    const crosswalkMarkdown = extractMarkdown(result.content);

    // Chunk and watermark the crosswalk
    const crosswalkCorpusId = `crosswalk-v1-${sessionId}`;
    const rawChunks = chunkCrosswalkMarkdown(crosswalkCorpusId, crosswalkMarkdown);
    const crosswalkChunks: CorpusChunkRaw[] = rawChunks.map((chunk) => ({
      ...chunk,
      content: injectWatermark(chunk.content, {
        corpusId: crosswalkCorpusId,
        sequence: chunk.sequence,
        contentHash: chunk.content_hash,
      }),
    }));

    // Store result on session
    await client
      .from("corpus_parse_sessions")
      .update({
        status: "crosswalk_done",
        crosswalk_markdown: crosswalkMarkdown,
        crosswalk_chunks_json: crosswalkChunks,
        crosswalk_model: model,
        crosswalk_tokens_in: result.inputTokens,
        crosswalk_tokens_out: result.outputTokens,
      })
      .eq("id", sessionId);

    return {
      crosswalkMarkdown,
      crosswalkChunks,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } catch (err) {
    // Revert session status
    await client
      .from("corpus_parse_sessions")
      .update({ status: "complete" })
      .eq("id", sessionId);

    throw err;
  }
}

/**
 * Save user edits to a session's crosswalk markdown.
 */
export async function saveCrosswalkEdit(
  client: SupabaseClient,
  sessionId: string,
  crosswalkMarkdown: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_sessions")
    .update({ crosswalk_markdown: crosswalkMarkdown })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to save crosswalk edit: ${error.message}`);
  }
}
