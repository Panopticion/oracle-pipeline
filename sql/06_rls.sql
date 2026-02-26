-- =============================================================================
-- 06_rls.sql — Row-level security for corpus content store
-- =============================================================================
-- Depends on: 04_builder.sql (user_org_ids), 05_content.sql
-- =============================================================================

-- Enable RLS
ALTER TABLE corpus_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_indexes ENABLE ROW LEVEL SECURITY;

-- pipeline_admin: full access
DROP POLICY IF EXISTS "pipeline_admin_all_corpus_documents" ON corpus_documents;
CREATE POLICY "pipeline_admin_all_corpus_documents"
  ON corpus_documents FOR ALL TO pipeline_admin
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_corpus_chunks" ON corpus_chunks;
CREATE POLICY "pipeline_admin_all_corpus_chunks"
  ON corpus_chunks FOR ALL TO pipeline_admin
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_corpus_indexes" ON corpus_indexes;
CREATE POLICY "pipeline_admin_all_corpus_indexes"
  ON corpus_indexes FOR ALL TO pipeline_admin
  USING (true) WITH CHECK (true);

-- ── corpus_documents (org-scoped) ──────────────────────────────────────────

DROP POLICY IF EXISTS "pipeline_user_read_corpus_documents" ON corpus_documents;
CREATE POLICY "pipeline_user_read_corpus_documents"
  ON corpus_documents FOR SELECT TO pipeline_user
  USING (
    is_active = true
    AND (
      organization_id IS NULL                          -- platform corpus
      OR organization_id IN (SELECT user_org_ids())    -- customer corpus
    )
  );

DROP POLICY IF EXISTS "pipeline_anon_read_corpus_documents" ON corpus_documents;
CREATE POLICY "pipeline_anon_read_corpus_documents"
  ON corpus_documents FOR SELECT TO pipeline_anon
  USING (is_active = true AND organization_id IS NULL);

-- ── corpus_chunks (org-scoped) ─────────────────────────────────────────────

DROP POLICY IF EXISTS "pipeline_user_read_corpus_chunks" ON corpus_chunks;
CREATE POLICY "pipeline_user_read_corpus_chunks"
  ON corpus_chunks FOR SELECT TO pipeline_user
  USING (
    document_id IN (
      SELECT id FROM corpus_documents
      WHERE is_active = true
        AND (
          organization_id IS NULL
          OR organization_id IN (SELECT user_org_ids())
        )
    )
  );

DROP POLICY IF EXISTS "pipeline_anon_read_corpus_chunks" ON corpus_chunks;
CREATE POLICY "pipeline_anon_read_corpus_chunks"
  ON corpus_chunks FOR SELECT TO pipeline_anon
  USING (
    document_id IN (
      SELECT id FROM corpus_documents
      WHERE is_active = true AND organization_id IS NULL
    )
  );

-- ── corpus_indexes (org-scoped) ────────────────────────────────────────────

DROP POLICY IF EXISTS "pipeline_user_read_corpus_indexes" ON corpus_indexes;
CREATE POLICY "pipeline_user_read_corpus_indexes"
  ON corpus_indexes FOR SELECT TO pipeline_user
  USING (
    document_id IN (
      SELECT id FROM corpus_documents
      WHERE is_active = true
        AND (
          organization_id IS NULL
          OR organization_id IN (SELECT user_org_ids())
        )
    )
  );
