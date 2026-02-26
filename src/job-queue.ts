/**
 * Postgres-backed job queue using FOR UPDATE SKIP LOCKED.
 *
 * Web app enqueues jobs; standalone worker claims and processes them.
 * All queue operations go through PL/pgSQL functions for atomicity.
 */

import type { SupabaseClient } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type JobKind = "parse_document" | "generate_crosswalk";

export type JobStatus = "pending" | "in_progress" | "done" | "failed";

export interface Job {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: JobStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  visible_at: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

/**
 * Insert a new job into the queue. Returns the job ID.
 */
export async function enqueueJob(
  client: SupabaseClient,
  kind: JobKind,
  payload: Record<string, unknown>,
): Promise<number> {
  const { data, error } = await client
    .from("corpus_jobs")
    .insert({ kind, payload })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to enqueue job: ${error.message}`);
  }

  return data.id as number;
}

// ─── Claim ───────────────────────────────────────────────────────────────────

/**
 * Atomically claim the next pending job with a lease.
 * Returns null if no jobs are available.
 */
export async function claimJob(
  client: SupabaseClient,
  leaseSeconds = 300,
): Promise<Job | null> {
  const { data, error } = await client.rpc("claim_next_job", {
    lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(`Failed to claim job: ${error.message}`);
  }

  const rows = data as Job[] | null;
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// ─── Complete ────────────────────────────────────────────────────────────────

/**
 * Mark a job as done with an optional result payload.
 */
export async function completeJob(
  client: SupabaseClient,
  jobId: number,
  result?: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .from("corpus_jobs")
    .update({
      status: "done",
      result: result ?? null,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to complete job ${jobId}: ${error.message}`);
  }
}

// ─── Fail ────────────────────────────────────────────────────────────────────

/**
 * Mark a job as failed. If retries remain, re-enqueue with backoff.
 */
export async function failJob(
  client: SupabaseClient,
  job: Job,
  errorMessage: string,
): Promise<void> {
  const exhausted = job.retry_count >= job.max_retries;

  if (exhausted) {
    const { error } = await client
      .from("corpus_jobs")
      .update({
        status: "failed",
        error: errorMessage,
      })
      .eq("id", job.id);

    if (error) {
      throw new Error(`Failed to mark job ${job.id} as failed: ${error.message}`);
    }
  } else {
    // Re-enqueue with exponential backoff (10s, 20s, 40s, ...)
    const backoffSeconds = 10 * Math.pow(2, job.retry_count - 1);

    const { error } = await client
      .from("corpus_jobs")
      .update({
        status: "pending",
        error: errorMessage,
        visible_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
      })
      .eq("id", job.id);

    if (error) {
      throw new Error(`Failed to re-enqueue job ${job.id}: ${error.message}`);
    }
  }
}

// ─── Reap ────────────────────────────────────────────────────────────────────

/**
 * Re-enqueue or fail stale in_progress jobs whose lease expired.
 * Returns the number of reaped jobs.
 */
export async function reapStaleJobs(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc("reap_stale_jobs");

  if (error) {
    throw new Error(`Failed to reap stale jobs: ${error.message}`);
  }

  return (data as number) ?? 0;
}
