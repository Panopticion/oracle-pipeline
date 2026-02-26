-- =============================================================================
-- 14_public_sessions.sql — Public sharing for parse sessions
-- =============================================================================
-- Depends on: 12_sessions.sql
-- =============================================================================
-- Adds an is_public flag so users can share read-only session work products
-- at /share/:id. Partial index keeps public lookups fast without bloating
-- the index for the (much larger) set of private sessions.
-- =============================================================================

ALTER TABLE corpus_parse_sessions
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_parse_sessions_public
  ON corpus_parse_sessions(is_public) WHERE is_public = true;

COMMENT ON COLUMN corpus_parse_sessions.is_public IS
  'When true, session is viewable at /share/:id without authentication.';
