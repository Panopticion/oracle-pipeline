-- =============================================================================
-- 07_retrieval.sql — Retrieval and pipeline functions
--   match_corpus_chunks, match_corpus_chunks_hybrid, upsert_corpus_document,
--   claim/complete/fail_corpus_chunk_embedding, start_pipeline_run
-- =============================================================================
-- Depends on: 05_content.sql, 03_sovereignty.sql
-- =============================================================================


-- ── Semantic similarity search ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_corpus_chunks(
  query_embedding         extensions.vector(512),
  match_count             INTEGER DEFAULT 10,
  match_threshold         FLOAT DEFAULT 0.7,
  filter_industries       TEXT[] DEFAULT NULL,
  filter_segments         TEXT[] DEFAULT NULL,
  filter_tier             corpus_tier DEFAULT NULL,
  filter_frameworks       TEXT[] DEFAULT NULL,
  filter_content_type     corpus_content_type DEFAULT NULL,
  filter_corpus_ids       TEXT[] DEFAULT NULL,
  filter_organization_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  document_id     UUID,
  corpus_id       TEXT,
  section_title   TEXT,
  content         TEXT,
  content_hash    TEXT,
  tier            corpus_tier,
  content_type    corpus_content_type,
  frameworks      TEXT[],
  industries      TEXT[],
  segments        TEXT[],
  sire_subject    TEXT,
  sire_included   TEXT[],
  sire_excluded   TEXT[],
  sire_relevant   TEXT[],
  similarity      FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.corpus_id,
    c.section_title,
    c.content,
    c.content_hash,
    c.tier,
    c.content_type,
    c.frameworks,
    c.industries,
    c.segments,
    c.sire_subject,
    c.sire_included,
    c.sire_excluded,
    c.sire_relevant,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM corpus_chunks c
  INNER JOIN corpus_documents d
    ON c.document_id = d.id
  WHERE
    c.embedding IS NOT NULL
    AND c.embedding_status = 'complete'
    AND d.is_active = true
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
    AND (filter_industries IS NULL
         OR c.industries && filter_industries
         OR c.industries @> ARRAY['*'])
    AND (filter_segments IS NULL
         OR c.segments && filter_segments
         OR c.segments @> ARRAY['*'])
    AND (filter_tier IS NULL
         OR c.tier = filter_tier)
    AND (filter_frameworks IS NULL
         OR c.frameworks && filter_frameworks
         OR c.frameworks @> ARRAY['*'])
    AND (filter_content_type IS NULL
         OR c.content_type = filter_content_type)
    AND (filter_corpus_ids IS NULL
         OR c.corpus_id = ANY(filter_corpus_ids))
    AND (
      d.organization_id IS NULL
      OR (
        filter_organization_id IS NOT NULL
        AND d.organization_id = filter_organization_id
      )
    )
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_corpus_chunks(
  extensions.vector, INTEGER, FLOAT, TEXT[], TEXT[],
  corpus_tier, TEXT[], corpus_content_type, TEXT[], UUID
) IS
  'Semantic similarity search over corpus chunks (text-embedding-3-large, 512d Matryoshka). '
  'Uses pgvector cosine distance with optional metadata filters. '
  'filter_organization_id scopes customer corpora; platform corpora always included.';


-- ── Hybrid search (vector + full-text) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION match_corpus_chunks_hybrid(
  query_embedding         extensions.vector(512),
  query_text              TEXT,
  match_count             INTEGER DEFAULT 10,
  match_threshold         FLOAT DEFAULT 0.005,
  semantic_weight         FLOAT DEFAULT 0.7,
  filter_industries       TEXT[] DEFAULT NULL,
  filter_segments         TEXT[] DEFAULT NULL,
  filter_tier             corpus_tier DEFAULT NULL,
  filter_content_type     corpus_content_type DEFAULT NULL,
  filter_corpus_ids       TEXT[] DEFAULT NULL,
  filter_organization_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  document_id     UUID,
  corpus_id       TEXT,
  section_title   TEXT,
  content         TEXT,
  content_hash    TEXT,
  tier            corpus_tier,
  content_type    corpus_content_type,
  frameworks      TEXT[],
  industries      TEXT[],
  segments        TEXT[],
  sire_subject    TEXT,
  sire_included   TEXT[],
  sire_excluded   TEXT[],
  sire_relevant   TEXT[],
  similarity      FLOAT,
  text_rank       FLOAT,
  combined_score  FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  text_weight FLOAT := 1.0 - semantic_weight;
  tsquery_val TSQUERY;
BEGIN
  -- Input validation
  IF match_count < 1 THEN
    match_count := 1;
  ELSIF match_count > 100 THEN
    match_count := 100;
  END IF;

  IF semantic_weight < 0.0 OR semantic_weight > 1.0 THEN
    RAISE EXCEPTION 'semantic_weight must be between 0.0 and 1.0 (got %)', semantic_weight;
  END IF;

  IF match_threshold < 0.0 OR match_threshold > 1.0 THEN
    RAISE EXCEPTION 'match_threshold must be between 0.0 and 1.0 (got %)', match_threshold;
  END IF;

  text_weight := 1.0 - semantic_weight;

  IF query_text IS NULL OR btrim(query_text) = '' THEN
    tsquery_val := NULL;
  ELSE
    tsquery_val := websearch_to_tsquery('english', query_text);
  END IF;

  RETURN QUERY
  WITH semantic AS (
    SELECT
      c.id AS chunk_id,
      1 - (c.embedding <=> query_embedding) AS sim_score,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS sim_rank
    FROM corpus_chunks c
    INNER JOIN corpus_documents d ON c.document_id = d.id
    WHERE
      c.embedding IS NOT NULL
      AND c.embedding_status = 'complete'
      AND d.is_active = true
      AND (filter_industries IS NULL OR c.industries && filter_industries OR c.industries @> ARRAY['*'])
      AND (filter_segments IS NULL OR c.segments && filter_segments OR c.segments @> ARRAY['*'])
      AND (filter_tier IS NULL OR c.tier = filter_tier)
      AND (filter_content_type IS NULL OR c.content_type = filter_content_type)
      AND (filter_corpus_ids IS NULL OR c.corpus_id = ANY(filter_corpus_ids))
      AND (
        d.organization_id IS NULL
        OR (
          filter_organization_id IS NOT NULL
          AND d.organization_id = filter_organization_id
        )
      )
    ORDER BY c.embedding <=> query_embedding
    LIMIT 200
  ),
  fulltext AS (
    SELECT
      c.id AS chunk_id,
      ts_rank_cd(c.content_tsv, tsquery_val, 32) AS ft_score,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.content_tsv, tsquery_val, 32) DESC) AS ft_rank
    FROM corpus_chunks c
    INNER JOIN corpus_documents d ON c.document_id = d.id
    WHERE
      tsquery_val IS NOT NULL
      AND c.content_tsv @@ tsquery_val
      AND d.is_active = true
      AND (filter_industries IS NULL OR c.industries && filter_industries OR c.industries @> ARRAY['*'])
      AND (filter_segments IS NULL OR c.segments && filter_segments OR c.segments @> ARRAY['*'])
      AND (filter_tier IS NULL OR c.tier = filter_tier)
      AND (filter_content_type IS NULL OR c.content_type = filter_content_type)
      AND (filter_corpus_ids IS NULL OR c.corpus_id = ANY(filter_corpus_ids))
      AND (
        d.organization_id IS NULL
        OR (
          filter_organization_id IS NOT NULL
          AND d.organization_id = filter_organization_id
        )
      )
    ORDER BY ft_score DESC
    LIMIT 200
  ),
  fused AS (
    SELECT
      COALESCE(s.chunk_id, f.chunk_id) AS chunk_id,
      COALESCE(s.sim_score, 0) AS sim_score,
      COALESCE(f.ft_score, 0) AS ft_score,
      -- RRF with k=20 (tuned for small corpus)
      (semantic_weight * (1.0 / (20 + COALESCE(s.sim_rank, 1000))))
      + (text_weight * (1.0 / (20 + COALESCE(f.ft_rank, 1000))))
      AS rrf_score
    FROM semantic s
    FULL OUTER JOIN fulltext f ON s.chunk_id = f.chunk_id
  )
  SELECT
    c.id,
    c.document_id,
    c.corpus_id,
    c.section_title,
    c.content,
    c.content_hash,
    c.tier,
    c.content_type,
    c.frameworks,
    c.industries,
    c.segments,
    c.sire_subject,
    c.sire_included,
    c.sire_excluded,
    c.sire_relevant,
    f.sim_score::FLOAT AS similarity,
    f.ft_score::FLOAT AS text_rank,
    f.rrf_score::FLOAT AS combined_score
  FROM fused f
  INNER JOIN corpus_chunks c ON c.id = f.chunk_id
  WHERE f.rrf_score >= match_threshold
  ORDER BY f.rrf_score DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_corpus_chunks_hybrid(
  extensions.vector, TEXT, INTEGER, FLOAT, FLOAT,
  TEXT[], TEXT[], corpus_tier, corpus_content_type, TEXT[], UUID
) IS
  'Hybrid search combining vector similarity and full-text matching '
  'via Reciprocal Rank Fusion (RRF, k=20). text-embedding-3-large (512d Matryoshka). '
  'Deep candidate pool (200) for accurate rank fusion. '
  'ts_rank_cd flag 32 normalizes for chunk length.';


-- ── Idempotent upsert function ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_corpus_document(
  p_corpus_id         TEXT,
  p_version           TEXT,
  p_title             TEXT,
  p_tier              corpus_tier,
  p_content_type      corpus_content_type,
  p_frameworks        TEXT[],
  p_industries        TEXT[],
  p_segments          TEXT[],
  p_source_url        TEXT DEFAULT NULL,
  p_source_publisher  TEXT DEFAULT NULL,
  p_last_verified     DATE DEFAULT NULL,
  p_content_hash      TEXT DEFAULT NULL,
  p_ingested_by       TEXT DEFAULT 'cli',
  p_organization_id   UUID DEFAULT NULL,
  p_language          TEXT DEFAULT 'english',
  p_sire_subject      TEXT DEFAULT NULL,
  p_sire_included     TEXT[] DEFAULT '{}',
  p_sire_excluded     TEXT[] DEFAULT '{}',
  p_sire_relevant     TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
  document_id UUID,
  action      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_existing_hash TEXT;
  v_new_id UUID;
BEGIN
  -- Advisory lock: serialize concurrent upserts for the same corpus_id + org scope.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_corpus_id),
    hashtext(COALESCE(p_organization_id::TEXT, 'platform'))
  );

  -- Check for existing document with same corpus_id + version + organization scope
  SELECT d.id, d.content_hash
    INTO v_existing_id, v_existing_hash
    FROM corpus_documents d
    WHERE d.corpus_id = p_corpus_id
      AND d.version = p_version
      AND (
        (p_organization_id IS NULL AND d.organization_id IS NULL)
        OR d.organization_id = p_organization_id
      );

  IF v_existing_id IS NOT NULL THEN
    -- Same content -> no-op
    IF v_existing_hash IS NOT NULL
       AND p_content_hash IS NOT NULL
       AND v_existing_hash = p_content_hash
    THEN
      RETURN QUERY SELECT v_existing_id, 'unchanged'::TEXT;
      RETURN;
    END IF;

    -- Different content -> update metadata, cascade delete chunks
    UPDATE corpus_documents SET
      title = p_title,
      tier = p_tier,
      content_type = p_content_type,
      frameworks = p_frameworks,
      industries = p_industries,
      segments = p_segments,
      source_url = p_source_url,
      source_publisher = p_source_publisher,
      last_verified = p_last_verified,
      content_hash = p_content_hash,
      chunk_count = 0,
      ingested_by = p_ingested_by,
      language = p_language,
      sire_subject = p_sire_subject,
      sire_included = p_sire_included,
      sire_excluded = p_sire_excluded,
      sire_relevant = p_sire_relevant
    WHERE id = v_existing_id;

    DELETE FROM corpus_chunks WHERE corpus_chunks.document_id = v_existing_id;
    DELETE FROM corpus_indexes WHERE corpus_indexes.document_id = v_existing_id;

    RETURN QUERY SELECT v_existing_id, 'updated'::TEXT;
    RETURN;
  END IF;

  -- New document -> deactivate previous versions of same corpus_id (within same org scope)
  UPDATE corpus_documents
    SET is_active = false
    WHERE corpus_documents.corpus_id = p_corpus_id
      AND is_active = true
      AND (
        (p_organization_id IS NULL AND organization_id IS NULL)
        OR organization_id = p_organization_id
      );

  INSERT INTO corpus_documents (
    corpus_id, version, title, tier, content_type,
    frameworks, industries, segments,
    source_url, source_publisher, last_verified,
    content_hash, ingested_by, organization_id, language,
    sire_subject, sire_included, sire_excluded, sire_relevant
  )
  VALUES (
    p_corpus_id, p_version, p_title, p_tier, p_content_type,
    p_frameworks, p_industries, p_segments,
    p_source_url, p_source_publisher, p_last_verified,
    p_content_hash, p_ingested_by, p_organization_id, p_language,
    p_sire_subject, p_sire_included, p_sire_excluded, p_sire_relevant
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, 'inserted'::TEXT;
END;
$$;

COMMENT ON FUNCTION upsert_corpus_document IS
  'Idempotent document upsert for corpus ingestion pipeline. '
  'Uses pg_advisory_xact_lock(int,int) to prevent TOCTOU race conditions. '
  'Supports both platform corpora (organization_id IS NULL) and '
  'customer corpora (organization_id set).';


-- ── VPC sovereignty embedding functions ──────────────────────────────────────

CREATE OR REPLACE FUNCTION claim_corpus_chunks_for_embedding(
  p_run_id                uuid,
  p_embedding_authority_id uuid,
  p_batch_size            integer DEFAULT 50,
  p_lease_seconds         integer DEFAULT 600,
  p_filter_corpus_ids     text[] DEFAULT NULL,
  p_filter_org_id         uuid DEFAULT NULL
)
RETURNS TABLE (
  chunk_id      uuid,
  document_id   uuid,
  corpus_id     text,
  section_title text,
  content       text,
  language      text,
  content_hash  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT c.id
    FROM corpus_chunks c
    JOIN corpus_documents d ON d.id = c.document_id
    WHERE
      d.is_active = true
      AND (
        c.embedding_status IN ('pending', 'stale')
        OR (c.embedding_status = 'processing' AND c.embedding_lease_expires_at <= v_now)
      )
      AND (p_filter_corpus_ids IS NULL OR c.corpus_id = ANY (p_filter_corpus_ids))
      AND (
        d.organization_id IS NULL
        OR (p_filter_org_id IS NOT NULL AND d.organization_id = p_filter_org_id)
      )
    ORDER BY c.updated_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF c SKIP LOCKED
  ),
  claimed AS (
    UPDATE corpus_chunks c
    SET
      embedding_status = 'processing',
      embedding_run_id = p_run_id,
      embedding_authority_id = p_embedding_authority_id,
      embedding_lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      embedding_error = NULL,
      updated_at = v_now
    FROM eligible e
    WHERE c.id = e.id
    RETURNING c.id, c.document_id, c.corpus_id, c.section_title, c.content, c.language, c.content_hash
  )
  SELECT
    claimed.id AS chunk_id,
    claimed.document_id,
    claimed.corpus_id,
    claimed.section_title,
    claimed.content,
    claimed.language,
    claimed.content_hash
  FROM claimed;
END;
$$;

COMMENT ON FUNCTION claim_corpus_chunks_for_embedding IS
  'Atomically claims corpus_chunks for embedding using a lease + run_id + authority fence. '
  'Uses FOR UPDATE SKIP LOCKED to avoid double-claim across workers.';


CREATE OR REPLACE FUNCTION complete_corpus_chunk_embedding(
  p_chunk_id                uuid,
  p_run_id                  uuid,
  p_embedding_authority_id  uuid,
  p_embedding               extensions.vector(512),
  p_embedding_model         text,
  p_embedding_model_version text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := now();
  v_doc_id uuid;
  v_hash text;
  v_updated int;
BEGIN
  UPDATE corpus_chunks
  SET
    embedding = p_embedding,
    embedding_status = 'complete',
    embedding_model = p_embedding_model,
    embedding_model_version = p_embedding_model_version,
    embedded_at = v_now,
    embedding_lease_expires_at = NULL,
    embedding_error = NULL,
    updated_at = v_now
  WHERE
    id = p_chunk_id
    AND embedding_status = 'processing'
    AND embedding_run_id = p_run_id
    AND embedding_authority_id = p_embedding_authority_id
    AND (embedding_lease_expires_at IS NULL OR embedding_lease_expires_at > v_now)
  RETURNING document_id, content_hash INTO v_doc_id, v_hash;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RETURN false;
  END IF;

  -- Append to immutable event log
  INSERT INTO corpus_embedding_events (
    run_id, embedding_authority_id,
    chunk_id, document_id,
    chunk_content_hash,
    embedding_model, embedding_model_version,
    status
  ) VALUES (
    p_run_id, p_embedding_authority_id,
    p_chunk_id, v_doc_id,
    v_hash,
    p_embedding_model, p_embedding_model_version,
    'complete'
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION complete_corpus_chunk_embedding IS
  'Completes embedding for a claimed chunk. Requires matching run_id + authority_id and valid lease. '
  'Writes to corpus_embedding_events (append-only audit log).';


CREATE OR REPLACE FUNCTION fail_corpus_chunk_embedding(
  p_chunk_id               uuid,
  p_run_id                 uuid,
  p_embedding_authority_id uuid,
  p_error                  text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_doc_id uuid;
  v_hash text;
  v_updated int;
BEGIN
  UPDATE corpus_chunks
  SET
    embedding_status = 'failed',
    embedding_error = left(coalesce(p_error, 'unknown error'), 4000),
    embedding_lease_expires_at = NULL,
    updated_at = v_now
  WHERE
    id = p_chunk_id
    AND embedding_status = 'processing'
    AND embedding_run_id = p_run_id
    AND embedding_authority_id = p_embedding_authority_id
  RETURNING document_id, content_hash INTO v_doc_id, v_hash;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RETURN false;
  END IF;

  INSERT INTO corpus_embedding_events (
    run_id, embedding_authority_id,
    chunk_id, document_id,
    chunk_content_hash,
    embedding_model,
    status,
    error
  ) VALUES (
    p_run_id, p_embedding_authority_id,
    p_chunk_id, v_doc_id,
    v_hash,
    'unknown',
    'failed',
    left(coalesce(p_error, 'unknown error'), 4000)
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION fail_corpus_chunk_embedding IS
  'Marks embedding failure for a claimed chunk (run_id + authority fenced). '
  'Writes to corpus_embedding_events (append-only audit log).';


-- ── start_pipeline_run (VPC sovereignty gate) ───────────────────────────────

CREATE OR REPLACE FUNCTION start_pipeline_run(
  p_run_id                 uuid,
  p_triggered_by           text,
  p_embedding_authority_id uuid,
  p_egress_policy_id       uuid,
  p_user_id                uuid DEFAULT NULL,
  p_organization_id        uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_active boolean;
  v_auth_env text;
  v_pol_active boolean;
  v_pol_scope text;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'run_id must not be NULL';
  END IF;

  IF p_triggered_by IS NULL OR btrim(p_triggered_by) = '' THEN
    RAISE EXCEPTION 'triggered_by must not be empty';
  END IF;

  -- Validate embedding authority
  SELECT a.is_active, a.environment
    INTO v_auth_active, v_auth_env
    FROM embedding_authorities a
    WHERE a.id = p_embedding_authority_id;

  IF v_auth_active IS NULL THEN
    RAISE EXCEPTION 'embedding_authority_id % not found', p_embedding_authority_id;
  END IF;

  IF v_auth_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'embedding_authority_id % is not active', p_embedding_authority_id;
  END IF;

  IF v_auth_env IS DISTINCT FROM 'vpc' THEN
    RAISE EXCEPTION 'embedding_authority_id % environment must be vpc (got %)', p_embedding_authority_id, v_auth_env;
  END IF;

  -- Validate egress policy
  SELECT p.is_active, p.scope
    INTO v_pol_active, v_pol_scope
    FROM egress_policies p
    WHERE p.id = p_egress_policy_id;

  IF v_pol_active IS NULL THEN
    RAISE EXCEPTION 'egress_policy_id % not found', p_egress_policy_id;
  END IF;

  IF v_pol_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'egress_policy_id % is not active', p_egress_policy_id;
  END IF;

  IF v_pol_scope IS DISTINCT FROM 'vpc' THEN
    RAISE EXCEPTION 'egress_policy_id % scope must be vpc (got %)', p_egress_policy_id, v_pol_scope;
  END IF;

  -- Org scope match enforcement
  IF p_organization_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_organization_id) THEN
      RAISE EXCEPTION 'organization_id % not found', p_organization_id;
    END IF;
  END IF;

  -- Insert run attestation (idempotent on run_id if bindings match)
  BEGIN
    INSERT INTO corpus_pipeline_run_attestations (
      run_id,
      organization_id,
      triggered_by,
      user_id,
      embedding_authority_id,
      egress_policy_id,
      environment
    )
    VALUES (
      p_run_id,
      p_organization_id,
      p_triggered_by,
      p_user_id,
      p_embedding_authority_id,
      p_egress_policy_id,
      'vpc'
    );
  EXCEPTION WHEN unique_violation THEN
    IF NOT EXISTS (
      SELECT 1
      FROM corpus_pipeline_run_attestations r
      WHERE r.run_id = p_run_id
        AND ((r.organization_id IS NULL AND p_organization_id IS NULL) OR r.organization_id = p_organization_id)
        AND r.embedding_authority_id = p_embedding_authority_id
        AND r.egress_policy_id = p_egress_policy_id
        AND r.environment = 'vpc'
        AND r.triggered_by = p_triggered_by
        AND ((r.user_id IS NULL AND p_user_id IS NULL) OR r.user_id = p_user_id)
    ) THEN
      RAISE EXCEPTION
        'run_id % already exists with different sovereignty bindings', p_run_id;
    END IF;
  END;

  RETURN p_run_id;
END;
$$;

COMMENT ON FUNCTION start_pipeline_run IS
  'Creates a VPC-tier pipeline run attestation (sovereignty receipt header). '
  'Enforces active embedding authority + active egress policy, both environment/scope=vpc. '
  'Idempotent by run_id only if all bindings match.';
