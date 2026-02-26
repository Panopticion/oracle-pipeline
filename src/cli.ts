#!/usr/bin/env tsx
/**
 * Corpus Pipeline CLI — run pipeline actions from the command line.
 *
 * Usage:
 *   npx tsx src/cli.ts --action validate
 *   npx tsx src/cli.ts --action ingest_and_embed
 *   npx tsx src/cli.ts --action embed_pending
 *   npx tsx src/cli.ts --action embed_pending --limit 100
 *   npx tsx src/cli.ts --action ingest --corpus compliance-iso-27001
 *
 * Environment:
 *   POSTGREST_URL             PostgREST URL (fallback: SUPABASE_URL)
 *   PIPELINE_ADMIN_KEY        Service-role JWT (fallback: SUPABASE_SERVICE_ROLE_KEY)
 *   OPENAI_API_KEY            OpenAI key (required for embed actions)
 *   EMBEDDING_AUTHORITY_ID    UUID from embedding_authorities table
 *   EGRESS_POLICY_ID          UUID from egress_policies table
 *   ORGANIZATION_ID           Optional org UUID for multi-tenant filtering
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { embedPendingChunks, registerPipelineRun } from "./embed";
import { executePipelineRequest } from "./execute";
import type { PipelineExecutionAction } from "./types";
import type { SovereigntyContext } from "./types";
import { submitForParsing, approveDraft } from "./parse";

// ─── Env ─────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

// ─── Args ────────────────────────────────────────────────────────────────────

const VALID_ACTIONS = new Set<string>([
  "validate",
  "ingest",
  "ingest_and_embed",
  "embed_pending",
  "rechunk",
  "ingest_content",
  "parse",
  "approve_draft",
]);

function printHelp(): never {
  console.log(`
Corpus Pipeline CLI

Usage:
  npx tsx src/cli.ts --action validate
  npx tsx src/cli.ts --action ingest --corpus gdpr-core-v1
  npx tsx src/cli.ts --action ingest_and_embed
  npx tsx src/cli.ts --action embed_pending --limit 100
  npx tsx src/cli.ts --action rechunk --corpus gdpr-core-v1
  npx tsx src/cli.ts --action parse --file ./regulation.txt
  npx tsx src/cli.ts --action approve_draft --draft-id <uuid>

Actions:
  validate          Validate corpus files from disk (no database needed)
  ingest            Validate + upsert documents and chunks to Supabase
  ingest_and_embed  Validate + ingest + generate embeddings
  embed_pending     Embed chunks that are pending (from previous ingest)
  rechunk           Force re-chunking even if content_hash unchanged
  parse             Upload a document for AI parsing into corpus format
  approve_draft     Approve a parsed draft → ingest + embed

Flags:
  --action <action>     Pipeline action (required, default: validate)
  --corpus <id>         Filter to a single corpus by ID
  --limit <n>           Max chunks to embed (embed_pending only)
  --file <path>         File to parse (parse action only)
  --draft-id <uuid>     Draft ID to approve (approve_draft action only)
  --tier <tier>         Hint: tier_1, tier_2, or tier_3 (parse only)
  --frameworks <list>   Hint: comma-separated frameworks (parse only)
  --dry-run             Skip writes, report what would happen
  --help                Show this help

Environment variables:
  validate needs nothing. All other actions need:
    POSTGREST_URL             PostgREST / Supabase URL
    PIPELINE_ADMIN_KEY        Service-role JWT

  Embed actions (ingest_and_embed, embed_pending, rechunk) also need:
    OPENAI_API_KEY            OpenAI API key
    EMBEDDING_AUTHORITY_ID    UUID from embedding_authorities table
    EGRESS_POLICY_ID          UUID from egress_policies table

  Parse action also needs:
    OPENROUTER_API_KEY        OpenRouter API key

  Optional:
    ORGANIZATION_ID           Org UUID for multi-tenant filtering
    OPENROUTER_MODEL          Override parse model (default: anthropic/claude-sonnet-4.6)
    WATERMARK_ENABLED         Set to "false" to disable watermarking
    WATERMARK_SECRET          HMAC secret for watermark signatures
`);
  process.exit(0);
}

function parseArgs(): {
  action: PipelineExecutionAction;
  corpusId?: string;
  limit?: number;
  dryRun: boolean;
  file?: string;
  draftId?: string;
  tier?: string;
  frameworks?: string[];
} {
  const args = process.argv.slice(2);
  let action: PipelineExecutionAction = "validate";
  let corpusId: string | undefined;
  let limit: number | undefined;
  let dryRun = false;
  let file: string | undefined;
  let draftId: string | undefined;
  let tier: string | undefined;
  let frameworks: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--action": {
        const val = args[++i];
        if (!val || val.startsWith("--")) {
          console.error("--action requires a value. Use --help for options.");
          process.exit(1);
        }
        if (!VALID_ACTIONS.has(val)) {
          console.error(
            `Unknown action "${val}". Valid actions: ${
              [...VALID_ACTIONS].join(", ")
            }`,
          );
          process.exit(1);
        }
        action = val as PipelineExecutionAction;
        break;
      }
      case "--corpus": {
        const val = args[++i];
        if (!val || val.startsWith("--")) {
          console.error(
            "--corpus requires a corpus ID. Use --help for options.",
          );
          process.exit(1);
        }
        corpusId = val;
        break;
      }
      case "--limit": {
        const val = args[++i];
        limit = Number.parseInt(val ?? "", 10);
        if (Number.isNaN(limit) || limit < 1) {
          console.error("--limit requires a positive integer.");
          process.exit(1);
        }
        break;
      }
      case "--file": {
        const val = args[++i];
        if (!val || val.startsWith("--")) {
          console.error("--file requires a path.");
          process.exit(1);
        }
        file = val;
        break;
      }
      case "--draft-id": {
        const val = args[++i];
        if (!val || val.startsWith("--")) {
          console.error("--draft-id requires a UUID.");
          process.exit(1);
        }
        draftId = val;
        break;
      }
      case "--tier": {
        const val = args[++i];
        if (!val || !["tier_1", "tier_2", "tier_3"].includes(val)) {
          console.error("--tier must be tier_1, tier_2, or tier_3.");
          process.exit(1);
        }
        tier = val;
        break;
      }
      case "--frameworks": {
        const val = args[++i];
        if (!val || val.startsWith("--")) {
          console.error("--frameworks requires a comma-separated list.");
          process.exit(1);
        }
        frameworks = val.split(",").map((s) => s.trim());
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        break;
      default:
        console.error(`Unknown flag: ${args[i]}. Use --help for options.`);
        process.exit(1);
    }
  }

  return { action, corpusId, limit, dryRun, file, draftId, tier, frameworks };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { action, corpusId, limit, dryRun, file, draftId, tier, frameworks } =
    parseArgs();

  // validate only reads corpus files from disk — no database needed
  const needsDb = action !== "validate";

  const supabaseUrl = needsDb
    ? (process.env.POSTGREST_URL ?? requireEnv("SUPABASE_URL"))
    : (process.env.POSTGREST_URL ?? "http://unused");
  const supabaseKey = needsDb
    ? (process.env.PIPELINE_ADMIN_KEY ??
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"))
    : (process.env.PIPELINE_ADMIN_KEY ?? "unused");
  const openaiApiKey = process.env.OPENAI_API_KEY;

  const client = createClient(supabaseUrl, supabaseKey);

  // Build sovereignty context for embed actions
  const embeddingAuthorityId = process.env.EMBEDDING_AUTHORITY_ID;
  const egressPolicyId = process.env.EGRESS_POLICY_ID;
  const organizationId = process.env.ORGANIZATION_ID;

  let sovereignty: SovereigntyContext | undefined;
  const needsSovereignty = action === "embed_pending" ||
    action === "ingest_and_embed" ||
    action === "rechunk";

  if (needsSovereignty) {
    if (!embeddingAuthorityId || !egressPolicyId) {
      console.error(
        "EMBEDDING_AUTHORITY_ID and EGRESS_POLICY_ID are required for embed actions.\n" +
          "See README § 'Seed sovereignty records' for setup instructions.",
      );
      process.exit(1);
    }
    sovereignty = {
      runId: crypto.randomUUID(),
      embeddingAuthorityId,
      egressPolicyId,
      organizationId,
      triggeredBy: "cli",
    };
  }

  console.log(
    `[corpus-pipeline] action=${action} corpus=${corpusId ?? "all"} dryRun=${
      String(dryRun)
    }`,
  );

  // ── parse: submit document for AI parsing ─────────────────────────────────
  if (action === "parse") {
    if (!file) {
      console.error("--file is required for parse action.");
      process.exit(1);
    }
    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) {
      console.error("OPENROUTER_API_KEY is required for parse action.");
      process.exit(1);
    }

    const sourceText = readFileSync(file, "utf-8");
    const sourceFileName = file.split("/").pop() ?? "upload.txt";

    console.log(
      `[corpus-pipeline] Parsing ${sourceFileName} (${String(sourceText.length)} chars)...`,
    );

    const result = await submitForParsing(client, sourceText, {
      openrouterApiKey,
      model: process.env.OPENROUTER_MODEL,
      sourceFileName,
      organizationId,
      hints: {
        tier,
        frameworks,
      },
      dryRun,
    });

    console.log(`[corpus-pipeline] Parse complete:`);
    console.log(`  Draft ID: ${result.draftId}`);
    console.log(`  Model: ${result.model}`);
    console.log(
      `  Tokens: ${String(result.inputTokens)} in / ${String(result.outputTokens)} out`,
    );

    if (dryRun) {
      console.log(`\n--- Parsed Markdown ---\n`);
      console.log(result.parsedMarkdown);
    } else {
      console.log(
        `\n  Review with: SELECT parsed_markdown FROM corpus_parse_drafts WHERE id = '${result.draftId}';`,
      );
      console.log(
        `  Approve with: npx tsx src/cli.ts --action approve_draft --draft-id ${result.draftId}`,
      );
    }
    return;
  }

  // ── approve_draft: approve parsed draft → ingest + embed ──────────────────
  if (action === "approve_draft") {
    if (!draftId) {
      console.error("--draft-id is required for approve_draft action.");
      process.exit(1);
    }

    console.log(`[corpus-pipeline] Approving draft ${draftId}...`);

    const result = await approveDraft(client, draftId, {
      ingestedBy: `parse-draft:${draftId}`,
      organizationId,
      openaiApiKey,
      sovereignty,
      skipEmbed: !openaiApiKey || !sovereignty,
    });

    console.log(`[corpus-pipeline] Draft approved:`);
    console.log(
      `  Document: ${result.ingestion.corpus_id} (${result.ingestion.document_id})`,
    );
    console.log(`  Action: ${result.ingestion.action}`);
    console.log(`  Chunks: ${String(result.ingestion.chunk_count)}`);
    if (result.embedding) {
      console.log(`  Embedded: ${String(result.embedding.embedded)}`);
    }
    return;
  }

  // ── embed_pending with limit support ─────────────────────────────────────
  if (action === "embed_pending" && limit) {
    if (!openaiApiKey) {
      console.error("OPENAI_API_KEY is required for embed actions.");
      process.exit(1);
    }
    if (!sovereignty) {
      console.error("Sovereignty context is required for embed_pending.");
      process.exit(1);
    }

    await registerPipelineRun(client, sovereignty);
    const result = await embedPendingChunks(client, {
      openaiApiKey,
      sovereignty,
      limit,
      dryRun,
    });
    console.log(
      `[corpus-pipeline] embedded=${String(result.embedded)} pending=${
        String(result.pending)
      }${result.failed ? ` failed=${String(result.failed)}` : ""}`,
    );
    return;
  }

  // ── All other actions via executePipelineRequest ─────────────────────────
  const response = await executePipelineRequest({
    client,
    request: { action, corpus_id: corpusId },
    openaiApiKey,
    sovereignty,
  });

  console.log(
    `[corpus-pipeline] summary:`,
    JSON.stringify(response.summary, null, 2),
  );

  // Print per-corpus details for pipeline actions
  if (response.results) {
    for (const r of response.results) {
      const status = r.validation.valid ? "✓" : "✗";
      const ing = r.ingestion?.action ?? "—";
      const emb = r.embedding
        ? `${String(r.embedding.embedded)} embedded`
        : "—";
      console.log(`  ${status} ${r.corpus_id}: ${ing} / ${emb}`);
    }
  }

  // Print validation-only results
  if (response.validations) {
    for (const v of response.validations) {
      const status = v.valid ? "✓" : "✗";
      const errs = v.errors.length > 0 ? ` (${v.errors.join("; ")})` : "";
      console.log(`  ${status} ${v.corpus_id}${errs}`);
    }
  }

  // Print embed result
  if (response.embedding) {
    console.log(
      `[corpus-pipeline] embedded=${
        String(response.embedding.embedded)
      } pending=${String(response.embedding.pending)}`,
    );
  }
}

main().catch((err) => {
  console.error("[corpus-pipeline] Fatal:", err);
  process.exit(1);
});
