-- =============================================================================
-- 15_job_queue.sql — Self-contained Postgres job queue
-- =============================================================================
-- Depends on: 12_sessions.sql
-- =============================================================================
-- Lightweight job queue using FOR UPDATE SKIP LOCKED for safe concurrent
-- claiming. Supports lease-based timeouts and automatic retries.
--
-- Job kinds: 'parse_document', 'generate_crosswalk'
-- Status flow: pending → in_progress → done | failed
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Jobs table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corpus_jobs (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
  result       JSONB,
  error        TEXT,
  visible_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  retry_count  INT NOT NULL DEFAULT 0,
  max_retries  INT NOT NULL DEFAULT 3,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index: only pending jobs that are visible
CREATE INDEX IF NOT EXISTS idx_jobs_claimable
  ON corpus_jobs(visible_at)
  WHERE status = 'pending';

-- Look up jobs by kind + status (monitoring, dashboards)
CREATE INDEX IF NOT EXISTS idx_jobs_kind_status
  ON corpus_jobs(kind, status);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS update_jobs_updated_at ON corpus_jobs;
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON corpus_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic claim — returns at most one job, locked with a lease
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION claim_next_job(lease_seconds INT DEFAULT 300)
RETURNS SETOF corpus_jobs
LANGUAGE sql
AS $$
  WITH cte AS (
    SELECT id
    FROM corpus_jobs
    WHERE status = 'pending'
      AND visible_at <= now()
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE corpus_jobs j
  SET status      = 'in_progress',
      visible_at  = now() + make_interval(secs => lease_seconds),
      retry_count = retry_count + 1,
      updated_at  = now()
  FROM cte
  WHERE j.id = cte.id
  RETURNING j.*;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reap stale jobs — re-enqueue or fail jobs whose lease expired
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reap_stale_jobs()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  reaped INT;
BEGIN
  WITH stale AS (
    SELECT id, retry_count, max_retries
    FROM corpus_jobs
    WHERE status = 'in_progress'
      AND visible_at < now()
    FOR UPDATE SKIP LOCKED
  )
  UPDATE corpus_jobs j
  SET status     = CASE
                     WHEN stale.retry_count >= stale.max_retries THEN 'failed'
                     ELSE 'pending'
                   END,
      error      = CASE
                     WHEN stale.retry_count >= stale.max_retries
                     THEN 'Lease expired after max retries'
                     ELSE j.error
                   END,
      visible_at = now(),
      updated_at = now()
  FROM stale
  WHERE j.id = stale.id;

  GET DIAGNOSTICS reaped = ROW_COUNT;
  RETURN reaped;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — service_role bypasses, but add policies for pipeline_admin
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE corpus_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_admin_all_jobs" ON corpus_jobs;
CREATE POLICY "pipeline_admin_all_jobs" ON corpus_jobs
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE corpus_jobs IS
  'Postgres-backed job queue. Workers claim jobs via claim_next_job() with FOR UPDATE SKIP LOCKED.';
COMMENT ON COLUMN corpus_jobs.kind IS
  'Job type: parse_document, generate_crosswalk.';
COMMENT ON COLUMN corpus_jobs.payload IS
  'Job-specific input: {documentId} for parse, {sessionId} for crosswalk.';
COMMENT ON COLUMN corpus_jobs.visible_at IS
  'Job is not claimable until this timestamp. Used for lease timeouts and retry backoff.';
COMMENT ON COLUMN corpus_jobs.retry_count IS
  'Incremented each time the job is claimed. Compared against max_retries for failure.';
COMMENT ON FUNCTION claim_next_job(INT) IS
  'Atomically claim the next pending job with a lease. Returns empty set if no jobs available.';
COMMENT ON FUNCTION reap_stale_jobs() IS
  'Re-enqueue or fail in_progress jobs whose lease has expired. Returns count of reaped jobs.';
