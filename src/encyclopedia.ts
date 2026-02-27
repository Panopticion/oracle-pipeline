/**
 * Encyclopedia — persistent document library.
 *
 * Documents graduate from ephemeral sessions into the Encyclopedia once they
 * are fully processed (watermarked). Crosswalks can be generated across
 * Encyclopedia entries regardless of which session they originated from.
 */

import type {
  EncyclopediaEntry,
  CorpusChunkRaw,
  CrosswalkResult,
  GenerateCrosswalkOptions,
  SupabaseClient,
} from "./types";
import { parseCorpusContent } from "./content-helpers";
import { callOpenRouter } from "./openrouter";
import {
  buildCrosswalkSystemPrompt,
  buildCrosswalkUserMessage,
} from "./prompts/crosswalk-document";
import type { CrosswalkDocumentInput } from "./prompts/crosswalk-document";
import { CROSSWALK_MODEL_DEFAULT } from "./constants";

// ─── Promote ─────────────────────────────────────────────────────────────────

/**
 * Promote a session document to the Encyclopedia.
 *
 * Reads the session document, validates it is watermarked, extracts metadata
 * from frontmatter, and upserts into corpus_encyclopedia. Idempotent — safe
 * to call multiple times for the same document (upserts on created_by + corpus_id).
 */
export async function promoteToEncyclopedia(
  client: SupabaseClient,
  documentId: string,
  userId: string,
): Promise<EncyclopediaEntry> {
  // Fetch the session document
  const { data: doc, error } = await client
    .from("corpus_session_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  if (doc.status !== "watermarked") {
    throw new Error(
      `Document must be watermarked before promoting to Encyclopedia (current status: ${doc.status})`,
    );
  }

  const markdown = (doc.user_markdown ?? doc.parsed_markdown ?? "") as string;
  if (!markdown.trim()) {
    throw new Error("Document has no content to promote");
  }

  // Extract metadata from frontmatter
  const corpus = parseCorpusContent(markdown);

  const entry = {
    created_by: userId,
    organization_id: (doc.organization_id as string | null) ?? null,
    corpus_id: corpus.corpus_id,
    title: corpus.title,
    tier: corpus.tier,
    frameworks: corpus.frameworks,
    industries: corpus.industries,
    segments: corpus.segments,
    source_filename: doc.source_filename as string,
    markdown,
    chunks_json: doc.chunks_json as CorpusChunkRaw[] | null,
    source_session_id: (doc.session_id as string) ?? null,
    source_document_id: documentId,
  };

  // Upsert on (created_by, corpus_id)
  const { data: upserted, error: upsertError } = await client
    .from("corpus_encyclopedia")
    .upsert(entry, { onConflict: "created_by,corpus_id" })
    .select("*")
    .single();

  if (upsertError) {
    throw new Error(
      `Failed to promote to Encyclopedia: ${upsertError.message}`,
    );
  }

  // Mark session document as promoted
  await client
    .from("corpus_session_documents")
    .update({ promoted_at: new Date().toISOString() })
    .eq("id", documentId);

  return upserted as EncyclopediaEntry;
}

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * List all Encyclopedia entries for a user, ordered newest first.
 */
export async function listEncyclopedia(
  client: SupabaseClient,
  userId: string,
): Promise<EncyclopediaEntry[]> {
  const { data, error } = await client
    .from("corpus_encyclopedia")
    .select("*")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list Encyclopedia: ${error.message}`);
  }

  return (data ?? []) as EncyclopediaEntry[];
}

// ─── Remove ──────────────────────────────────────────────────────────────────

/**
 * Remove an entry from the Encyclopedia.
 */
export async function removeEncyclopediaEntry(
  client: SupabaseClient,
  entryId: string,
): Promise<void> {
  const { error } = await client
    .from("corpus_encyclopedia")
    .delete()
    .eq("id", entryId);

  if (error) {
    throw new Error(
      `Failed to remove Encyclopedia entry: ${error.message}`,
    );
  }
}

// ─── Crosswalk ───────────────────────────────────────────────────────────────

/**
 * Generate a crosswalk across selected Encyclopedia entries.
 *
 * Fetches the entries, builds CrosswalkDocumentInput[], and calls OpenRouter
 * using the existing crosswalk prompt machinery.
 */
export async function generateEncyclopediaCrosswalk(
  client: SupabaseClient,
  entryIds: string[],
  userId: string,
  options: GenerateCrosswalkOptions,
): Promise<CrosswalkResult> {
  if (entryIds.length < 2) {
    throw new Error(
      "Need at least 2 Encyclopedia entries to generate a crosswalk",
    );
  }

  const model = options.model ?? CROSSWALK_MODEL_DEFAULT;

  // Fetch selected entries scoped to user
  const { data: entries, error } = await client
    .from("corpus_encyclopedia")
    .select("*")
    .eq("created_by", userId)
    .in("id", entryIds);

  if (error) {
    throw new Error(`Failed to fetch Encyclopedia entries: ${error.message}`);
  }

  if (!entries || entries.length < 2) {
    throw new Error(
      "Could not find enough Encyclopedia entries for crosswalk",
    );
  }

  // Build crosswalk inputs
  const crosswalkInputs: CrosswalkDocumentInput[] = entries.map((entry) => {
    let corpusId = entry.corpus_id as string;
    let title = entry.title as string;
    let tier = entry.tier as string;
    let frameworks = (entry.frameworks as string[]) ?? [];

    try {
      const corpus = parseCorpusContent(entry.markdown as string);
      corpusId = corpus.corpus_id;
      title = corpus.title;
      tier = corpus.tier;
      frameworks = corpus.frameworks;
    } catch {
      // Use stored metadata if parsing fails
    }

    return {
      corpusId,
      title,
      tier,
      frameworks,
      markdown: entry.markdown as string,
    };
  });

  // Call OpenRouter
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

  // Extract markdown from fenced blocks if present
  const raw = result.content;
  const fenceMatch = raw.match(/```(?:markdown)?\s*\n([\s\S]*)\n\s*```\s*$/);
  const crosswalkMarkdown = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  return {
    crosswalkMarkdown,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
