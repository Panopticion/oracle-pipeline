-- =============================================================================
-- 11_parse_drafts.sql — Document upload + AI parse staging table
-- =============================================================================
-- Depends on: 00_roles.sql, 02_console.sql, 05_content.sql
-- =============================================================================
-- Stores uploaded documents, AI-parsed corpus Markdown, and review workflow
-- state. Approved drafts become corpus_documents via the standard pipeline.
-- =============================================================================

CREATE TABLE IF NOT EXISTS corpus_parse_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Upload info
  source_filename TEXT NOT NULL,
  source_text     TEXT NOT NULL,
  source_hash     TEXT NOT NULL,

  -- AI parse result
  parsed_markdown TEXT,
  parse_model     TEXT,
  parse_tokens_in INTEGER,
  parse_tokens_out INTEGER,

  -- Review state
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'parsing', 'parsed', 'approved', 'rejected', 'failed')),
  user_markdown   TEXT,
  reviewer_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewer_notes  TEXT,

  -- Link to created document (after approval)
  document_id     UUID REFERENCES corpus_documents(id) ON DELETE SET NULL,

  -- Lifecycle
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT parse_drafts_source_unique UNIQUE (organization_id, source_hash)
);

CREATE INDEX IF NOT EXISTS idx_parse_drafts_org ON corpus_parse_drafts(organization_id);
CREATE INDEX IF NOT EXISTS idx_parse_drafts_status ON corpus_parse_drafts(status);
CREATE INDEX IF NOT EXISTS idx_parse_drafts_hash ON corpus_parse_drafts(source_hash);

DROP TRIGGER IF EXISTS update_parse_drafts_updated_at ON corpus_parse_drafts;
CREATE TRIGGER update_parse_drafts_updated_at
  BEFORE UPDATE ON corpus_parse_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE corpus_parse_drafts ENABLE ROW LEVEL SECURITY;

-- pipeline_admin: full access
DROP POLICY IF EXISTS "pipeline_admin_all_parse_drafts" ON corpus_parse_drafts;
CREATE POLICY "pipeline_admin_all_parse_drafts" ON corpus_parse_drafts
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

-- pipeline_user: read own org drafts
DROP POLICY IF EXISTS "users_read_own_org_parse_drafts" ON corpus_parse_drafts;
CREATE POLICY "users_read_own_org_parse_drafts" ON corpus_parse_drafts
  FOR SELECT TO pipeline_user
  USING (organization_id IN (SELECT user_org_ids()));

-- pipeline_user: manage own org drafts (admin/owner only)
DROP POLICY IF EXISTS "users_manage_own_org_parse_drafts" ON corpus_parse_drafts;
CREATE POLICY "users_manage_own_org_parse_drafts" ON corpus_parse_drafts
  FOR ALL TO pipeline_user
  USING (organization_id IN (SELECT user_admin_org_ids()))
  WITH CHECK (organization_id IN (SELECT user_admin_org_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE corpus_parse_drafts IS
  'Document upload + AI parse staging. Approved drafts become corpus_documents.';
COMMENT ON COLUMN corpus_parse_drafts.source_hash IS
  'SHA-256 of source_text — used for deduplication.';
COMMENT ON COLUMN corpus_parse_drafts.parsed_markdown IS
  'AI-generated corpus Markdown with YAML frontmatter.';
COMMENT ON COLUMN corpus_parse_drafts.user_markdown IS
  'User-edited version of parsed_markdown (NULL = no edits).';
COMMENT ON COLUMN corpus_parse_drafts.parse_model IS
  'OpenRouter model used for parsing (e.g. anthropic/claude-sonnet-4.6).';
