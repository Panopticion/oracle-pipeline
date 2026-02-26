-- =============================================================================
-- 08_views.sql — Summary views for admin console
-- =============================================================================
-- Depends on: 05_content.sql
-- =============================================================================

-- ── Document summary view (admin dashboard) ─────────────────────────────────

CREATE OR REPLACE VIEW corpus_documents_summary AS
SELECT
  d.id,
  d.corpus_id,
  d.version,
  d.title,
  d.tier,
  d.content_type,
  d.frameworks,
  d.industries,
  d.segments,
  d.chunk_count,
  d.total_tokens,
  d.is_active,
  d.last_verified,
  d.ingested_at,
  d.updated_at,
  d.organization_id,
  -- Embedding coverage
  COUNT(c.id) FILTER (WHERE c.embedding_status = 'complete') AS embedded_chunks,
  COUNT(c.id) FILTER (WHERE c.embedding_status = 'pending') AS pending_chunks,
  COUNT(c.id) FILTER (WHERE c.embedding_status = 'failed') AS failed_chunks,
  COUNT(c.id) FILTER (WHERE c.embedding_status = 'processing') AS processing_chunks,
  -- Latest index info
  (SELECT i.embedding_model
     FROM corpus_indexes i
     WHERE i.document_id = d.id
     ORDER BY i.created_at DESC
     LIMIT 1
  ) AS latest_embedding_model
FROM corpus_documents d
LEFT JOIN corpus_chunks c ON c.document_id = d.id
GROUP BY d.id;

CREATE OR REPLACE VIEW corpus_chunks_detail AS
SELECT
  c.id,
  c.corpus_id,
  c.section_title,
  c.sequence,
  c.tier,
  c.content_type,
  c.frameworks,
  c.industries,
  c.segments,
  c.token_count,
  c.embedding_status,
  c.content_hash,
  c.heading_path,
  c.created_at,
  c.embedded_at,
  c.embedding_authority_id,
  c.embedding_run_id,
  c.embedding_lease_expires_at,
  c.embedding_error,
  d.title AS document_title,
  d.is_active AS document_active,
  d.organization_id,
  length(c.content) AS content_length_chars
FROM corpus_chunks c
INNER JOIN corpus_documents d ON c.document_id = d.id;
