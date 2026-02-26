-- =============================================================================
-- 12_sessions.sql — Multi-document parse sessions with crosswalk support
-- =============================================================================
-- Depends on: 00_roles.sql, 02_console.sql, 11_parse_drafts.sql
-- =============================================================================
-- Groups multiple document uploads into a session. Users upload N documents,
-- each is AI-parsed and reviewed, then a crosswalk is generated across all
-- documents. The bundle (documents + crosswalk) can be downloaded as a ZIP.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Sessions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corpus_parse_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Session metadata
  name                TEXT NOT NULL DEFAULT 'Untitled Session',
  status              TEXT NOT NULL DEFAULT 'uploading'
                      CHECK (status IN (
                        'uploading',         -- accepting document uploads
                        'complete',          -- all documents parsed/edited, ready for crosswalk
                        'crosswalk_pending', -- crosswalk generation in progress
                        'crosswalk_done',    -- crosswalk generated, ready for download
                        'archived'           -- session archived by user
                      )),

  -- Crosswalk result (populated after generation)
  crosswalk_markdown  TEXT,
  crosswalk_model     TEXT,
  crosswalk_tokens_in INTEGER,
  crosswalk_tokens_out INTEGER,

  -- Lifecycle
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parse_sessions_org
  ON corpus_parse_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_parse_sessions_status
  ON corpus_parse_sessions(status);
CREATE INDEX IF NOT EXISTS idx_parse_sessions_created_by
  ON corpus_parse_sessions(created_by);

DROP TRIGGER IF EXISTS update_parse_sessions_updated_at ON corpus_parse_sessions;
CREATE TRIGGER update_parse_sessions_updated_at
  BEFORE UPDATE ON corpus_parse_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Session Documents
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corpus_session_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES corpus_parse_sessions(id) ON DELETE CASCADE,
  organization_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Upload info
  source_filename     TEXT NOT NULL,
  source_text         TEXT NOT NULL,
  source_hash         TEXT NOT NULL,

  -- AI parse result
  parsed_markdown     TEXT,
  parse_model         TEXT,
  parse_tokens_in     INTEGER,
  parse_tokens_out    INTEGER,

  -- Review state
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN (
                        'pending',   -- uploaded, not yet parsed
                        'parsing',   -- AI parse in progress
                        'parsed',    -- AI parse complete
                        'edited',    -- user has edited the parsed result
                        'failed'     -- AI parse failed
                      )),
  user_markdown       TEXT,
  error_message       TEXT,

  -- Ordering within session
  sort_order          INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Prevent duplicate uploads within the same session
  CONSTRAINT session_docs_source_unique UNIQUE (session_id, source_hash)
);

CREATE INDEX IF NOT EXISTS idx_session_docs_session
  ON corpus_session_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_session_docs_org
  ON corpus_session_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_session_docs_status
  ON corpus_session_documents(status);

DROP TRIGGER IF EXISTS update_session_docs_updated_at ON corpus_session_documents;
CREATE TRIGGER update_session_docs_updated_at
  BEFORE UPDATE ON corpus_session_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE corpus_parse_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_session_documents ENABLE ROW LEVEL SECURITY;

-- Sessions: pipeline_admin full access
DROP POLICY IF EXISTS "pipeline_admin_all_sessions" ON corpus_parse_sessions;
CREATE POLICY "pipeline_admin_all_sessions" ON corpus_parse_sessions
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

-- Sessions: pipeline_user read own org
DROP POLICY IF EXISTS "users_read_own_org_sessions" ON corpus_parse_sessions;
CREATE POLICY "users_read_own_org_sessions" ON corpus_parse_sessions
  FOR SELECT TO pipeline_user
  USING (organization_id IN (SELECT user_org_ids()));

-- Sessions: pipeline_user manage own org (admin/owner only)
DROP POLICY IF EXISTS "users_manage_own_org_sessions" ON corpus_parse_sessions;
CREATE POLICY "users_manage_own_org_sessions" ON corpus_parse_sessions
  FOR ALL TO pipeline_user
  USING (organization_id IN (SELECT user_admin_org_ids()))
  WITH CHECK (organization_id IN (SELECT user_admin_org_ids()));

-- Documents: pipeline_admin full access
DROP POLICY IF EXISTS "pipeline_admin_all_session_docs" ON corpus_session_documents;
CREATE POLICY "pipeline_admin_all_session_docs" ON corpus_session_documents
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

-- Documents: pipeline_user read own org
DROP POLICY IF EXISTS "users_read_own_org_session_docs" ON corpus_session_documents;
CREATE POLICY "users_read_own_org_session_docs" ON corpus_session_documents
  FOR SELECT TO pipeline_user
  USING (organization_id IN (SELECT user_org_ids()));

-- Documents: pipeline_user manage own org (admin/owner only)
DROP POLICY IF EXISTS "users_manage_own_org_session_docs" ON corpus_session_documents;
CREATE POLICY "users_manage_own_org_session_docs" ON corpus_session_documents
  FOR ALL TO pipeline_user
  USING (organization_id IN (SELECT user_admin_org_ids()))
  WITH CHECK (organization_id IN (SELECT user_admin_org_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE corpus_parse_sessions IS
  'Multi-document parse session. Groups uploads into a batch with crosswalk generation.';
COMMENT ON TABLE corpus_session_documents IS
  'Individual documents within a parse session. Each uploaded, AI-parsed, and reviewed.';

COMMENT ON COLUMN corpus_parse_sessions.status IS
  'Session lifecycle: uploading -> complete -> crosswalk_pending -> crosswalk_done -> archived';
COMMENT ON COLUMN corpus_parse_sessions.crosswalk_markdown IS
  'AI-generated cross-framework mapping markdown (populated after crosswalk generation).';

COMMENT ON COLUMN corpus_session_documents.source_hash IS
  'SHA-256 of source_text — prevents duplicate uploads within a session.';
COMMENT ON COLUMN corpus_session_documents.parsed_markdown IS
  'AI-generated corpus Markdown with YAML frontmatter.';
COMMENT ON COLUMN corpus_session_documents.user_markdown IS
  'User-edited version of parsed_markdown (NULL = no edits).';
COMMENT ON COLUMN corpus_session_documents.sort_order IS
  'Display order within the session (0-indexed).';
