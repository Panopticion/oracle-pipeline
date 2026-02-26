-- =============================================================================
-- 10_grants.sql — Function grants (pipeline_admin only)
-- =============================================================================
-- Depends on: 07_retrieval.sql
-- =============================================================================

-- Retrieval functions: pipeline_admin only (called from server-side API routes)
REVOKE EXECUTE ON FUNCTION match_corpus_chunks(
  extensions.vector, INTEGER, FLOAT, TEXT[], TEXT[],
  corpus_tier, TEXT[], corpus_content_type, TEXT[], UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION match_corpus_chunks(
  extensions.vector, INTEGER, FLOAT, TEXT[], TEXT[],
  corpus_tier, TEXT[], corpus_content_type, TEXT[], UUID
) TO pipeline_admin;

REVOKE EXECUTE ON FUNCTION match_corpus_chunks_hybrid(
  extensions.vector, TEXT, INTEGER, FLOAT, FLOAT,
  TEXT[], TEXT[], corpus_tier, corpus_content_type, TEXT[], UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION match_corpus_chunks_hybrid(
  extensions.vector, TEXT, INTEGER, FLOAT, FLOAT,
  TEXT[], TEXT[], corpus_tier, corpus_content_type, TEXT[], UUID
) TO pipeline_admin;

REVOKE EXECUTE ON FUNCTION upsert_corpus_document(
  TEXT, TEXT, TEXT, corpus_tier, corpus_content_type,
  TEXT[], TEXT[], TEXT[], TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT,
  TEXT, TEXT[], TEXT[], TEXT[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION upsert_corpus_document(
  TEXT, TEXT, TEXT, corpus_tier, corpus_content_type,
  TEXT[], TEXT[], TEXT[], TEXT, TEXT, DATE, TEXT, TEXT, UUID, TEXT,
  TEXT, TEXT[], TEXT[], TEXT[]
) TO pipeline_admin;

-- Embedding claim/complete/fail + start_pipeline_run: pipeline_admin only
REVOKE EXECUTE ON FUNCTION claim_corpus_chunks_for_embedding(
  uuid, uuid, integer, integer, text[], uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION claim_corpus_chunks_for_embedding(
  uuid, uuid, integer, integer, text[], uuid
) TO pipeline_admin;

REVOKE EXECUTE ON FUNCTION complete_corpus_chunk_embedding(
  uuid, uuid, uuid, extensions.vector, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION complete_corpus_chunk_embedding(
  uuid, uuid, uuid, extensions.vector, text, text
) TO pipeline_admin;

REVOKE EXECUTE ON FUNCTION fail_corpus_chunk_embedding(
  uuid, uuid, uuid, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION fail_corpus_chunk_embedding(
  uuid, uuid, uuid, text
) TO pipeline_admin;

REVOKE EXECUTE ON FUNCTION start_pipeline_run(
  uuid, text, uuid, uuid, uuid, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION start_pipeline_run(
  uuid, text, uuid, uuid, uuid, uuid
) TO pipeline_admin;
