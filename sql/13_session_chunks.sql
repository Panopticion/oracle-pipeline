-- =============================================================================
-- 13_session_chunks.sql — Add chunk + watermark pipeline stages to sessions
-- =============================================================================
-- Depends on: 12_sessions.sql
-- =============================================================================
-- Extends corpus_session_documents with:
--   - chunks_json JSONB column for storing chunked (and later watermarked) content
--   - Two new status values: 'chunked' and 'watermarked'
--
-- Pipeline flow:
--   pending → parsing → parsed ⇄ edited → chunked → watermarked → ready
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend status CHECK constraint
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE corpus_session_documents
  DROP CONSTRAINT IF EXISTS corpus_session_documents_status_check;

ALTER TABLE corpus_session_documents
  ADD CONSTRAINT corpus_session_documents_status_check
  CHECK (status IN (
    'pending',       -- uploaded, not yet parsed
    'parsing',       -- AI parse in progress
    'parsed',        -- AI parse complete, awaiting review
    'edited',        -- user has edited the parsed result
    'failed',        -- AI parse failed
    'chunked',       -- document chunked, awaiting review
    'watermarked'    -- chunks watermarked, ready for download
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- Add chunks_json column
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE corpus_session_documents
  ADD COLUMN IF NOT EXISTS chunks_json JSONB;

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN corpus_session_documents.chunks_json IS
  'Array of CorpusChunkRaw objects from chunkCorpus(). Updated in-place with watermarks after watermark stage.';

COMMENT ON COLUMN corpus_session_documents.status IS
  'Document lifecycle: pending → parsing → parsed ⇄ edited → chunked → watermarked';
