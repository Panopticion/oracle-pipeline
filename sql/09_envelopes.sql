-- =============================================================================
-- 09_envelopes.sql — Pipeline envelopes + embedding event log + RLS
-- =============================================================================
-- Depends on: 00_roles.sql, 03_sovereignty.sql, 05_content.sql
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════════
-- PIPELINE ENVELOPES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS corpus_pipeline_envelopes (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  run_id        uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Who triggered it
  triggered_by  text NOT NULL,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,

  -- What action
  action        text NOT NULL,
  corpus_id     text,

  -- Pipeline results (per-corpus JSONB)
  validation    jsonb,
  ingestion     jsonb,
  embedding     jsonb,

  -- Denormalized for quick filtering
  validation_valid  boolean,
  ingestion_action  text,
  chunk_count       int,
  embedded_count    int,

  -- Timing
  started_at    timestamptz NOT NULL,
  completed_at  timestamptz,
  duration_ms   int,

  -- Error (if pipeline threw)
  error         text,

  -- Rechunk metadata (when action = rechunk)
  rechunk_meta  jsonb,

  -- VPC sovereignty bindings (denormalized from run attestation)
  organization_id         uuid REFERENCES organizations(id) ON DELETE SET NULL,
  embedding_authority_id   uuid REFERENCES embedding_authorities(id),
  egress_policy_id         uuid REFERENCES egress_policies(id),
  attestation_run_id       uuid REFERENCES corpus_pipeline_run_attestations(run_id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX idx_pipeline_envelopes_run_id
  ON corpus_pipeline_envelopes (run_id);
CREATE INDEX idx_pipeline_envelopes_corpus_id
  ON corpus_pipeline_envelopes (corpus_id);
CREATE INDEX idx_pipeline_envelopes_created_at
  ON corpus_pipeline_envelopes (created_at DESC);
CREATE INDEX idx_pipeline_envelopes_triggered_by
  ON corpus_pipeline_envelopes (triggered_by);
CREATE INDEX idx_pipeline_envelopes_action
  ON corpus_pipeline_envelopes (ingestion_action);
CREATE INDEX IF NOT EXISTS idx_pipeline_env_att_run
  ON corpus_pipeline_envelopes (attestation_run_id);

-- Comments
COMMENT ON TABLE corpus_pipeline_envelopes
  IS 'Observability trail for corpus pipeline runs. One row per corpus per run.';
COMMENT ON COLUMN corpus_pipeline_envelopes.run_id
  IS 'UUID grouping all corpora processed in a single pipeline invocation.';
COMMENT ON COLUMN corpus_pipeline_envelopes.triggered_by
  IS 'Source of the pipeline run: cli, admin-ui, or corpus-builder.';
COMMENT ON COLUMN corpus_pipeline_envelopes.rechunk_meta
  IS 'Metadata for rechunk operations: old_chunk_count, new_chunk_count, changed_sections.';

-- RLS
ALTER TABLE corpus_pipeline_envelopes ENABLE ROW LEVEL SECURITY;

-- pipeline_admin can do everything (used by API route and CLI)
CREATE POLICY "pipeline_admin_full_access" ON corpus_pipeline_envelopes
  FOR ALL TO pipeline_admin
  USING (true) WITH CHECK (true);

-- Summary view for admin console
CREATE OR REPLACE VIEW corpus_pipeline_envelope_summary AS
SELECT
  e.run_id,
  e.action,
  e.triggered_by,
  e.user_id,
  min(e.created_at) AS started_at,
  max(e.completed_at) AS completed_at,
  count(*) AS corpus_count,
  count(*) FILTER (WHERE e.validation_valid) AS valid_count,
  count(*) FILTER (WHERE e.ingestion_action IN ('inserted', 'updated')) AS ingested_count,
  coalesce(sum(e.embedded_count), 0) AS total_embedded,
  count(*) FILTER (WHERE e.error IS NOT NULL) AS error_count,
  max(e.duration_ms) AS max_duration_ms
FROM corpus_pipeline_envelopes e
GROUP BY e.run_id, e.action, e.triggered_by, e.user_id
ORDER BY min(e.created_at) DESC;

COMMENT ON VIEW corpus_pipeline_envelope_summary
  IS 'Aggregated view of pipeline runs for the admin console.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- EMBEDDING EVENT LOG (append-only forensics)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS corpus_embedding_events (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  occurred_at             timestamptz NOT NULL DEFAULT now(),

  run_id                  uuid NOT NULL REFERENCES corpus_pipeline_run_attestations(run_id) ON DELETE CASCADE,
  embedding_authority_id  uuid NOT NULL REFERENCES embedding_authorities(id),

  chunk_id                uuid NOT NULL REFERENCES corpus_chunks(id) ON DELETE CASCADE,
  document_id             uuid NOT NULL REFERENCES corpus_documents(id) ON DELETE CASCADE,

  chunk_content_hash      text NOT NULL,
  embedding_model         text NOT NULL,
  embedding_model_version text,

  status                  text NOT NULL CHECK (status IN ('complete', 'failed')),
  error                   text
);

CREATE INDEX IF NOT EXISTS idx_corpus_embedding_events_run
  ON corpus_embedding_events (run_id);

CREATE INDEX IF NOT EXISTS idx_corpus_embedding_events_chunk
  ON corpus_embedding_events (chunk_id);

-- Append-only (pipeline_admin inserts + selects; deny update/delete)
ALTER TABLE corpus_embedding_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_admin_insert_embedding_events" ON corpus_embedding_events;
CREATE POLICY "pipeline_admin_insert_embedding_events" ON corpus_embedding_events
  FOR INSERT TO pipeline_admin WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_select_embedding_events" ON corpus_embedding_events;
CREATE POLICY "pipeline_admin_select_embedding_events" ON corpus_embedding_events
  FOR SELECT TO pipeline_admin USING (true);

DROP POLICY IF EXISTS "deny_update_embedding_events" ON corpus_embedding_events;
CREATE POLICY "deny_update_embedding_events" ON corpus_embedding_events AS RESTRICTIVE
  FOR UPDATE TO pipeline_user USING (false);

DROP POLICY IF EXISTS "deny_delete_embedding_events" ON corpus_embedding_events;
CREATE POLICY "deny_delete_embedding_events" ON corpus_embedding_events AS RESTRICTIVE
  FOR DELETE TO pipeline_user USING (false);

COMMENT ON TABLE corpus_embedding_events IS
  'Append-only forensic log of all embedding operations. Written by '
  'complete_corpus_chunk_embedding and fail_corpus_chunk_embedding. '
  'Prevents silent mutation and provides durable audit trail.';
