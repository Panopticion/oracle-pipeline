/**
 * Document parsing workflow — upload → AI parse → draft → approve → pipeline.
 *
 * Composes the CFPO prompt (prompts/parse-document.ts) with the OpenRouter
 * client (openrouter.ts) and hands approved drafts to the existing pipeline.
 */

import { createHash } from "node:crypto";
import type {
  ApproveDraftOptions,
  ApproveDraftResult,
  ParseOptions,
  ParseResult,
  SupabaseClient,
} from "./types";
import { callOpenRouter } from "./openrouter";
import {
  buildParseSystemPrompt,
  buildParseUserMessage,
} from "./prompts/parse-document";
import { parseCorpusContent } from "./content-helpers";
import { runPipeline } from "./pipeline";
import { registerPipelineRun } from "./embed";
import { PARSE_MODEL_DEFAULT } from "./constants";

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Extract markdown content from an AI response that may wrap it in code fences.
 */
function extractMarkdown(raw: string): string {
  // Match ```markdown ... ``` or ``` ... ```
  const fenceMatch = raw.match(
    /```(?:markdown)?\s*\n([\s\S]*?)\n\s*```/,
  );
  if (fenceMatch) return fenceMatch[1].trim();

  // No fences — return as-is (the AI followed instructions poorly, but content may still be valid)
  return raw.trim();
}

// ─── Submit for parsing ─────────────────────────────────────────────────────

/**
 * Submit a raw document for AI parsing via OpenRouter.
 *
 * 1. Creates a draft row with status 'pending'
 * 2. Calls OpenRouter with the CFPO-structured prompt
 * 3. Updates the draft with parsed result
 *
 * @returns The draft ID and parsed Markdown for review
 */
export async function submitForParsing(
  client: SupabaseClient,
  sourceText: string,
  options: ParseOptions,
): Promise<ParseResult> {
  const model = options.model ?? PARSE_MODEL_DEFAULT;
  const sourceHash = sha256(sourceText);

  // ── Create draft row ──────────────────────────────────────────────────
  let draftId: string;

  if (!options.dryRun) {
    const { data, error } = await client
      .from("corpus_parse_drafts")
      .insert({
        source_filename: options.sourceFileName ?? "upload.txt",
        source_text: sourceText,
        source_hash: sourceHash,
        status: "parsing",
        parse_model: model,
        organization_id: options.organizationId ?? null,
        created_by: options.userId ?? null,
      })
      .select("id")
      .single();

    if (error) {
      // Check for duplicate
      if (error.code === "23505") {
        throw new Error(
          `Document already submitted (duplicate source hash: ${sourceHash.slice(0, 12)}...)`,
        );
      }
      throw new Error(`Failed to create parse draft: ${error.message}`);
    }

    draftId = data.id;
  } else {
    draftId = "dry-run";
  }

  // ── Call OpenRouter ───────────────────────────────────────────────────
  try {
    const systemPrompt = buildParseSystemPrompt(model, options.hints);
    const userMessage = buildParseUserMessage(
      sourceText,
      options.sourceFileName,
    );

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

    const parsedMarkdown = extractMarkdown(result.content);

    // Validate that the AI produced parseable corpus markdown
    try {
      parseCorpusContent(parsedMarkdown);
    } catch (parseErr) {
      const msg =
        parseErr instanceof Error ? parseErr.message : String(parseErr);

      if (!options.dryRun) {
        await client
          .from("corpus_parse_drafts")
          .update({
            status: "failed",
            reviewer_notes: `AI output failed validation: ${msg}`,
            parsed_markdown: parsedMarkdown,
            parse_tokens_in: result.inputTokens,
            parse_tokens_out: result.outputTokens,
          })
          .eq("id", draftId);
      }

      throw new Error(
        `AI produced invalid corpus Markdown: ${msg}\n\nRaw output saved to draft ${draftId} for inspection.`,
      );
    }

    // ── Update draft with parsed result ─────────────────────────────────
    if (!options.dryRun) {
      await client
        .from("corpus_parse_drafts")
        .update({
          parsed_markdown: parsedMarkdown,
          parse_tokens_in: result.inputTokens,
          parse_tokens_out: result.outputTokens,
          status: "parsed",
        })
        .eq("id", draftId);
    }

    return {
      draftId,
      parsedMarkdown,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } catch (err) {
    // Mark draft as failed if it's not already a validation error
    if (!options.dryRun && draftId !== "dry-run") {
      const msg = err instanceof Error ? err.message : String(err);
      await client
        .from("corpus_parse_drafts")
        .update({
          status: "failed",
          reviewer_notes: `Parse failed: ${msg}`,
        })
        .eq("id", draftId);
    }

    throw err;
  }
}

// ─── Approve draft ──────────────────────────────────────────────────────────

/**
 * Approve a parse draft and run it through the existing pipeline.
 *
 * Takes the user-edited markdown (if any) or the AI-parsed markdown,
 * validates it, then feeds it to runPipeline (validate → ingest → embed).
 */
export async function approveDraft(
  client: SupabaseClient,
  draftId: string,
  options: ApproveDraftOptions = {},
): Promise<ApproveDraftResult> {
  // ── Fetch draft ───────────────────────────────────────────────────────
  const { data: draft, error } = await client
    .from("corpus_parse_drafts")
    .select("*")
    .eq("id", draftId)
    .single();

  if (error || !draft) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  if (draft.status === "approved") {
    throw new Error(`Draft ${draftId} is already approved`);
  }

  if (draft.status !== "parsed" && draft.status !== "failed") {
    throw new Error(
      `Draft ${draftId} is in status '${draft.status as string}' — only 'parsed' or 'failed' drafts can be approved`,
    );
  }

  // Use user-edited version if available, otherwise AI-parsed version
  const markdown =
    (draft.user_markdown as string | null) ??
    (draft.parsed_markdown as string | null);

  if (!markdown) {
    throw new Error(`Draft ${draftId} has no parsed markdown`);
  }

  // ── Parse and validate ────────────────────────────────────────────────
  const corpus = parseCorpusContent(markdown);

  // ── Register sovereignty if embedding ─────────────────────────────────
  const skipEmbed = options.skipEmbed ?? !options.openaiApiKey;
  if (!skipEmbed && options.sovereignty) {
    await registerPipelineRun(client, options.sovereignty);
  }

  // ── Run through existing pipeline ─────────────────────────────────────
  const result = await runPipeline(client, corpus, {
    requireFactCheck: false, // AI-parsed docs use fact_check.status: ai_parsed
    ingestedBy: options.ingestedBy ?? `parse-draft:${draftId}`,
    organizationId: options.organizationId,
    openaiApiKey: options.openaiApiKey,
    skipEmbed,
    sovereignty: options.sovereignty,
  });

  if (!result.ingestion || result.ingestion.action === "blocked") {
    throw new Error(
      `Pipeline rejected the parsed document: ${
        result.validation.errors.join("; ") || "ingestion blocked"
      }`,
    );
  }

  // ── Update draft status ───────────────────────────────────────────────
  await client
    .from("corpus_parse_drafts")
    .update({
      status: "approved",
      document_id: result.ingestion.document_id,
      reviewer_id: options.organizationId ?? null,
    })
    .eq("id", draftId);

  return {
    draftId,
    ingestion: result.ingestion,
    embedding: result.embedding ?? undefined,
  };
}

// ─── Reject draft ───────────────────────────────────────────────────────────

/**
 * Reject a parse draft with optional reviewer notes.
 */
export async function rejectDraft(
  client: SupabaseClient,
  draftId: string,
  notes?: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_parse_drafts")
    .update({
      status: "rejected",
      reviewer_notes: notes ?? null,
    })
    .eq("id", draftId);

  if (error) {
    throw new Error(`Failed to reject draft: ${error.message}`);
  }
}
