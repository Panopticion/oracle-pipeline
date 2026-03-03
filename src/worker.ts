/**
 * Standalone job queue worker.
 *
 * Polls corpus_jobs for pending work and dispatches to the appropriate
 * handler (parse_document, generate_crosswalk). Designed to run as a
 * long-lived process alongside the web app.
 *
 * Usage:
 *   npx tsx src/worker.ts
 *
 * Environment variables:
 *   SUPABASE_URL           — Supabase project URL
 *   SUPABASE_SERVICE_KEY   — Service role key (bypasses RLS)
 *   OPENROUTER_API_KEY     — OpenRouter API key for AI calls
 *   WORKER_POLL_MS         — Poll interval in ms (default: 2000)
 *   WORKER_LEASE_SECONDS   — Job lease duration (default: 600)
 */

import { createClient } from "@supabase/supabase-js";
import {
  claimJob,
  completeJob,
  failJob,
  reapStaleJobs,
  updateJobProgress,
  type Job,
} from "./job-queue";
import {
  reparseDocument,
  generateCrosswalk,
} from "./sessions";

function loadEnvironmentFiles() {
  if (typeof process.loadEnvFile !== "function") return;

  const candidates = [
    new URL("../.env.local", import.meta.url),
    new URL("../.env", import.meta.url),
  ];

  for (const fileUrl of candidates) {
    try {
      process.loadEnvFile(fileUrl);
    } catch {
      // File missing or unreadable — continue to next candidate.
    }
  }
}

loadEnvironmentFiles();

// ─── Config ──────────────────────────────────────────────────────────────────

const POLL_MS = parseInt(process.env.WORKER_POLL_MS ?? "2000", 10);
const LEASE_SECONDS = parseInt(process.env.WORKER_LEASE_SECONDS ?? "600", 10);
const REAP_INTERVAL_MS = 60_000; // Check for stale jobs every 60s

// ─── Supabase client ─────────────────────────────────────────────────────────

function getClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_KEY environment variables.",
    );
    process.exit(1);
  }

  return createClient(url, key);
}

function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("Missing OPENROUTER_API_KEY environment variable.");
    process.exit(1);
  }
  return key;
}

// ─── Job handlers ────────────────────────────────────────────────────────────

async function handleParseDocument(
  job: Job,
): Promise<Record<string, unknown>> {
  const client = getClient();
  const { documentId, parsePromptProfile } = job.payload as {
    documentId: string;
    parsePromptProfile?: "published_standard" | "interpretation" | "firecrawl_prepped";
  };

  console.log(`  [parse] documentId=${documentId}`);

  await updateJobProgress(client, job.id, {
    step: "claimed",
    message: "Worker claimed parse job",
  });

  // Parse only — user reviews, then triggers chunk/watermark manually
  const result = await reparseDocument(client, documentId, {
    openrouterApiKey: getOpenRouterKey(),
    parsePromptProfile,
    onProgress: async (progress) => {
      await updateJobProgress(client, job.id, progress);
    },
  });

  await updateJobProgress(client, job.id, {
    step: "completed",
    message: "Parse job completed",
  });

  return {
    documentId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalSourceChunks: result.totalSourceChunks,
    omissionChunkCount: result.omissionChunkCount,
    recoveredChunkCount: result.recoveredChunkCount,
    auditWarnings: result.auditWarnings,
  };
}

async function handleGenerateCrosswalk(
  job: Job,
): Promise<Record<string, unknown>> {
  const client = getClient();
  const { sessionId } = job.payload as { sessionId: string };

  console.log(`  [crosswalk] sessionId=${sessionId}`);

  const result = await generateCrosswalk(client, sessionId, {
    openrouterApiKey: getOpenRouterKey(),
  });

  return {
    sessionId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

async function processJob(job: Job): Promise<Record<string, unknown>> {
  switch (job.kind) {
    case "parse_document":
      return handleParseDocument(job);
    case "generate_crosswalk":
      return handleGenerateCrosswalk(job);
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}

// ─── Main loop ───────────────────────────────────────────────────────────────

let running = true;

function shutdown() {
  console.log("\nShutting down worker...");
  running = false;
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  console.log("Worker started");
  console.log(`  poll=${POLL_MS}ms  lease=${LEASE_SECONDS}s  reap=${REAP_INTERVAL_MS}ms`);

  const client = getClient();
  let lastReap = Date.now();

  while (running) {
    try {
      // Periodically reap stale jobs
      if (Date.now() - lastReap > REAP_INTERVAL_MS) {
        const reaped = await reapStaleJobs(client);
        if (reaped > 0) {
          console.log(`Reaped ${reaped} stale job(s)`);
        }
        lastReap = Date.now();
      }

      // Claim next job
      const job = await claimJob(client, LEASE_SECONDS);

      if (!job) {
        await sleep(POLL_MS);
        continue;
      }

      console.log(`Claimed job #${job.id} [${job.kind}] (attempt ${job.retry_count})`);

      try {
        const result = await processJob(job);
        await completeJob(client, job.id, result);
        console.log(`Completed job #${job.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed job #${job.id}: ${msg}`);

        try {
          await failJob(client, job, msg);
        } catch (failErr) {
          console.error(
            `Could not update job #${job.id} status:`,
            failErr instanceof Error ? failErr.message : failErr,
          );
        }
      }
    } catch (err) {
      // Top-level error (claim/reap failed) — wait and retry
      console.error(
        "Worker loop error:",
        err instanceof Error ? err.message : err,
      );
      await sleep(POLL_MS * 2);
    }
  }

  console.log("Worker stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Worker crashed:", err);
  process.exit(1);
});
