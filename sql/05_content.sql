-- =============================================================================
-- 05_content.sql — Corpus content store: enums, documents, chunks, indexes,
--                  pipeline run attestations + triggers
-- =============================================================================
-- Depends on: 00_roles.sql, 01_extensions.sql, 02_console.sql, 03_sovereignty.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Content store enums
-- ─────────────────────────────────────────────────────────────────────────────

-- Corpus tier: regulatory mandate -> industry standard -> best practice
DO $$ BEGIN
  CREATE TYPE corpus_tier AS ENUM ('tier_1', 'tier_2', 'tier_3');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Corpus content type: determines retrieval signal behavior
DO $$ BEGIN
  CREATE TYPE corpus_content_type AS ENUM ('prose', 'boundary', 'structured');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Chunk embedding status: tracks processing pipeline state
DO $$ BEGIN
  CREATE TYPE chunk_embedding_status AS ENUM (
    'pending',     -- Chunk created, embedding not yet computed
    'processing',  -- Embedding computation in progress
    'complete',    -- Embedding stored and verified
    'failed',      -- Embedding computation failed
    'stale'        -- Source content changed, re-embedding needed
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- CORPUS DOCUMENTS
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- One row per corpus markdown file. Mirrors frontmatter 1:1.
-- organization_id IS NULL = platform corpus (shared, Ontic-maintained)
-- organization_id IS NOT NULL = customer corpus (org-scoped)

CREATE TABLE IF NOT EXISTS corpus_documents (
  -- Identity (UUIDv7: time-ordered for sequential B-tree writes)
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  corpus_id       TEXT NOT NULL,                              -- e.g. "gdpr", "hipaa", "boundaries"
  version         TEXT NOT NULL DEFAULT '1',                  -- Bumping triggers re-embedding

  -- Metadata (from frontmatter)
  title           TEXT NOT NULL,
  tier            corpus_tier NOT NULL DEFAULT 'tier_2',
  content_type    corpus_content_type NOT NULL DEFAULT 'prose',
  frameworks      TEXT[] NOT NULL DEFAULT '{}',               -- e.g. {"GDPR (EU) 2016/679"}
  industries      TEXT[] NOT NULL DEFAULT '{"*"}',            -- Wizard taxonomy slugs or {"*"}
  segments        TEXT[] NOT NULL DEFAULT '{"*"}',            -- Wizard taxonomy slugs or {"*"}

  -- Provenance
  source_url      TEXT,
  source_publisher TEXT,
  last_verified   DATE,

  -- Content integrity
  content_hash    TEXT,                                       -- SHA-256 of full markdown body
  chunk_count     INTEGER NOT NULL DEFAULT 0,                 -- Denormalized for quick stats
  total_tokens    INTEGER,                                    -- Approximate token count

  -- Language (for i18n text search stemming)
  language        TEXT NOT NULL DEFAULT 'english',            -- Postgres regconfig name

  -- S.I.R.E. identity-first retrieval metadata (optional — NULL = bypass gating)
  sire_subject    TEXT,                                       -- Domain label (e.g. "data_protection")
  sire_included   TEXT[] NOT NULL DEFAULT '{}',               -- Editorial keywords for search
  sire_excluded   TEXT[] NOT NULL DEFAULT '{}',               -- Anti-keywords for deterministic gating
  sire_relevant   TEXT[] NOT NULL DEFAULT '{}',               -- Cross-framework IDs for topology

  -- Lifecycle
  is_active       BOOLEAN NOT NULL DEFAULT true,              -- Soft delete / disable
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_by     TEXT,                                       -- CLI script or admin user

  -- Organization scope
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Constraints
  CONSTRAINT corpus_documents_version_not_empty
    CHECK (version != ''),
  CONSTRAINT corpus_documents_corpus_id_format
    CHECK (corpus_id ~ '^[a-z][a-z0-9_-]*$'),
  CONSTRAINT corpus_documents_chunk_count_non_negative
    CHECK (chunk_count >= 0)
);

-- Primary lookup: by corpus_id (most common query path)
CREATE INDEX IF NOT EXISTS idx_corpus_documents_corpus_id
  ON corpus_documents(corpus_id);

CREATE INDEX IF NOT EXISTS idx_corpus_documents_tier
  ON corpus_documents(tier);

CREATE INDEX IF NOT EXISTS idx_corpus_documents_content_type
  ON corpus_documents(content_type);

CREATE INDEX IF NOT EXISTS idx_corpus_documents_frameworks
  ON corpus_documents USING GIN (frameworks);

CREATE INDEX IF NOT EXISTS idx_corpus_documents_industries
  ON corpus_documents USING GIN (industries);

CREATE INDEX IF NOT EXISTS idx_corpus_documents_segments
  ON corpus_documents USING GIN (segments);

CREATE INDEX IF NOT EXISTS idx_corpus_documents_sire_excluded
  ON corpus_documents USING GIN (sire_excluded);

CREATE INDEX IF NOT EXISTS idx_corpus_documents_sire_included
  ON corpus_documents USING GIN (sire_included);

CREATE INDEX IF NOT EXISTS idx_corpus_documents_active
  ON corpus_documents(corpus_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_corpus_documents_org
  ON corpus_documents(organization_id)
  WHERE organization_id IS NOT NULL;

-- Platform corpora: one version per corpus_id (globally unique, no org)
CREATE UNIQUE INDEX IF NOT EXISTS idx_corpus_documents_platform_id_version
  ON corpus_documents(corpus_id, version)
  WHERE organization_id IS NULL;

-- Customer corpora: one version per corpus_id per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_corpus_documents_customer_id_version
  ON corpus_documents(corpus_id, version, organization_id)
  WHERE organization_id IS NOT NULL;

-- Platform corpora: one active version per corpus_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_corpus_documents_platform_one_active
  ON corpus_documents(corpus_id)
  WHERE is_active = true AND organization_id IS NULL;

-- Customer corpora: one active version per corpus_id per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_corpus_documents_customer_one_active
  ON corpus_documents(corpus_id, organization_id)
  WHERE is_active = true AND organization_id IS NOT NULL;

COMMENT ON COLUMN corpus_documents.organization_id IS
  'NULL = platform corpus (shared across all users). '
  'Non-NULL = customer corpus scoped to a specific organization.';

DROP TRIGGER IF EXISTS update_corpus_documents_updated_at ON corpus_documents;
CREATE TRIGGER update_corpus_documents_updated_at
  BEFORE UPDATE ON corpus_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE corpus_documents IS
  'Platform-level corpus documents (compliance frameworks). '
  'One row per markdown file. Frontmatter metadata stored here; '
  'content split into corpus_chunks for retrieval.';

COMMENT ON COLUMN corpus_documents.corpus_id IS
  'Unique identifier matching the corpus markdown frontmatter corpus_id. '
  'Lowercase kebab/snake_case. Used for idempotent upsert.';

COMMENT ON COLUMN corpus_documents.content_hash IS
  'SHA-256 of the full markdown body (excluding frontmatter). '
  'Used for change detection and RFC-0007 evidence binding.';

COMMENT ON COLUMN corpus_documents.language IS
  'Postgres regconfig name for full-text search stemming (e.g., english).';


-- ═══════════════════════════════════════════════════════════════════════════════
-- PIPELINE RUN ATTESTATIONS (VPC sovereignty receipt headers)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS corpus_pipeline_run_attestations (
  run_id                  uuid PRIMARY KEY,
  created_at              timestamptz NOT NULL DEFAULT now(),

  -- Optional scope (platform runs can be NULL)
  organization_id         uuid REFERENCES organizations(id) ON DELETE SET NULL,
  triggered_by            text NOT NULL,
  user_id                 uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Sovereignty bindings
  embedding_authority_id  uuid NOT NULL REFERENCES embedding_authorities(id),
  egress_policy_id        uuid NOT NULL REFERENCES egress_policies(id),
  environment             text NOT NULL DEFAULT 'vpc',

  -- Manifests: sha256 hex digests of canonical input/output lists
  input_manifest_hash     text,
  output_manifest_hash    text
);

COMMENT ON TABLE corpus_pipeline_run_attestations IS
  'VPC-tier sovereignty receipt header. Every embedding pipeline run must register '
  'an attestation binding run_id to an embedding authority, egress policy, and org scope '
  'before any chunks can be claimed. FK from corpus_chunks.embedding_run_id enforces this.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- CORPUS CHUNKS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS corpus_chunks (
  -- Identity (UUIDv7: time-ordered for sequential B-tree writes)
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  document_id     UUID NOT NULL
                    REFERENCES corpus_documents(id) ON DELETE CASCADE,

  -- Position within document
  sequence        INTEGER NOT NULL,
  section_title   TEXT NOT NULL,
  heading_level   INTEGER NOT NULL DEFAULT 2,

  -- Content
  content         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  token_count     INTEGER,

  -- Hierarchy (for hierarchical chunking)
  parent_chunk_id UUID REFERENCES corpus_chunks(id)
                    ON DELETE SET NULL,
  heading_path    TEXT[],

  -- Denormalized document metadata (avoids JOIN at retrieval time)
  corpus_id       TEXT NOT NULL,
  tier            corpus_tier NOT NULL,
  content_type    corpus_content_type NOT NULL,
  frameworks      TEXT[] NOT NULL DEFAULT '{}',
  industries      TEXT[] NOT NULL DEFAULT '{}',
  segments        TEXT[] NOT NULL DEFAULT '{}',

  -- Language (denormalized from document for tsvector trigger)
  language        TEXT NOT NULL DEFAULT 'english',

  -- S.I.R.E. identity-first retrieval metadata (denormalized from document)
  sire_subject    TEXT,
  sire_included   TEXT[] NOT NULL DEFAULT '{}',
  sire_excluded   TEXT[] NOT NULL DEFAULT '{}',
  sire_relevant   TEXT[] NOT NULL DEFAULT '{}',

  -- Embedding
  embedding       extensions.vector(512),
  embedding_status chunk_embedding_status NOT NULL DEFAULT 'pending',
  embedding_model  TEXT,
  embedding_model_version TEXT,
  embedded_at     TIMESTAMPTZ,

  -- Lease / run-fencing + VPC sovereignty attribution
  embedding_authority_id  UUID REFERENCES embedding_authorities(id),
  embedding_run_id        UUID REFERENCES corpus_pipeline_run_attestations(run_id),
  embedding_lease_expires_at TIMESTAMPTZ,
  embedding_error           TEXT,

  -- Full-text search
  content_tsv     TSVECTOR,

  -- Lifecycle
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT corpus_chunks_document_sequence_unique
    UNIQUE (document_id, sequence),
  CONSTRAINT corpus_chunks_document_section_unique
    UNIQUE (document_id, section_title),
  CONSTRAINT corpus_chunks_sequence_non_negative
    CHECK (sequence >= 0),
  CONSTRAINT corpus_chunks_heading_level_valid
    CHECK (heading_level BETWEEN 1 AND 6),
  CONSTRAINT corpus_chunks_content_not_empty
    CHECK (length(content) > 0),
  CONSTRAINT corpus_chunks_hash_format
    CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  -- VPC sovereignty: embeddings MUST be attributed to a run + authority
  CONSTRAINT corpus_chunks_embedding_attributed
    CHECK (
      embedding IS NULL
      OR (embedding_authority_id IS NOT NULL AND embedding_run_id IS NOT NULL)
    )
);

-- ── B-tree indexes ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_document_id
  ON corpus_chunks(document_id);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_corpus_id
  ON corpus_chunks(corpus_id);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_content_type
  ON corpus_chunks(content_type);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_embedding_pending
  ON corpus_chunks(embedding_status)
  WHERE embedding_status IN ('pending', 'stale');

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_embedding_processing_lease
  ON corpus_chunks(embedding_lease_expires_at)
  WHERE embedding_status = 'processing';

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_embedding_run_id
  ON corpus_chunks(embedding_run_id)
  WHERE embedding_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_embedding_authority
  ON corpus_chunks(embedding_authority_id)
  WHERE embedding_authority_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_document_sequence
  ON corpus_chunks(document_id, sequence);

-- ── GIN indexes for array containment (retrieval filtering) ─────────────────

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_frameworks
  ON corpus_chunks USING GIN (frameworks);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_industries
  ON corpus_chunks USING GIN (industries);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_segments
  ON corpus_chunks USING GIN (segments);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_sire_excluded
  ON corpus_chunks USING GIN (sire_excluded);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_sire_included
  ON corpus_chunks USING GIN (sire_included);

-- ── Full-text search index ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_content_tsv
  ON corpus_chunks USING GIN (content_tsv);

-- ── Vector similarity index (HNSW) ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_embedding_hnsw
  ON corpus_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 24, ef_construction = 200)
  WHERE embedding IS NOT NULL;

-- ── Triggers ────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS update_corpus_chunks_updated_at ON corpus_chunks;
CREATE TRIGGER update_corpus_chunks_updated_at
  BEFORE UPDATE ON corpus_chunks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-generate tsvector from content (dynamic language via regconfig)
CREATE OR REPLACE FUNCTION corpus_chunks_tsv_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.content_tsv :=
    setweight(to_tsvector(NEW.language::regconfig, COALESCE(NEW.section_title, '')), 'A') ||
    setweight(to_tsvector(NEW.language::regconfig, COALESCE(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS corpus_chunks_tsv_update ON corpus_chunks;
CREATE TRIGGER corpus_chunks_tsv_update
  BEFORE INSERT OR UPDATE OF content, section_title, language ON corpus_chunks
  FOR EACH ROW
  EXECUTE FUNCTION corpus_chunks_tsv_trigger();

-- Auto-update parent document chunk_count
CREATE OR REPLACE FUNCTION corpus_chunks_count_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE corpus_documents
      SET chunk_count = chunk_count + 1
      WHERE id = NEW.document_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE corpus_documents
      SET chunk_count = GREATEST(chunk_count - 1, 0)
      WHERE id = OLD.document_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS corpus_chunks_count ON corpus_chunks;
CREATE TRIGGER corpus_chunks_count
  AFTER INSERT OR DELETE ON corpus_chunks
  FOR EACH ROW
  EXECUTE FUNCTION corpus_chunks_count_trigger();

COMMENT ON TABLE corpus_chunks IS
  'Headed sections of corpus documents with pgvector embeddings. '
  'Each ## heading in an corpus markdown file becomes one chunk. '
  'Metadata denormalized from parent document for fast filtered retrieval.';

COMMENT ON COLUMN corpus_chunks.content_hash IS
  'SHA-256 hex digest of the chunk content. Used for change detection, '
  'deduplication, and RFC-0007 evidence binding (claim-to-source tracing).';

COMMENT ON COLUMN corpus_chunks.embedding IS
  'Vector embedding (512 dims, text-embedding-3-large Matryoshka). '
  'NULL until embedding pipeline processes the chunk.';

COMMENT ON COLUMN corpus_chunks.language IS
  'Denormalized Postgres regconfig name for per-chunk full-text search.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- CORPUS INDEXES (provenance tracking)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS corpus_indexes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was indexed
  corpus_id               TEXT NOT NULL,
  corpus_version          TEXT NOT NULL,
  document_id             UUID NOT NULL
                            REFERENCES corpus_documents(id) ON DELETE CASCADE,

  -- Embedding configuration
  embedding_model         TEXT NOT NULL,
  embedding_model_version TEXT NOT NULL,
  embedding_dimensions    INTEGER NOT NULL DEFAULT 512,

  -- Chunking configuration
  chunking_strategy       TEXT NOT NULL DEFAULT 'semantic_boundary',
  chunk_size_tokens       INTEGER NOT NULL DEFAULT 512,
  chunk_overlap_tokens    INTEGER NOT NULL DEFAULT 64,

  -- Results
  chunk_count             INTEGER NOT NULL,
  total_tokens            INTEGER,

  -- Integrity (RFC-0007)
  index_hash              TEXT,
  content_hash            TEXT,

  -- Freshness
  freshness_policy_days   INTEGER DEFAULT 90,
  last_verified_at        TIMESTAMPTZ,

  -- Lifecycle
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ,
  created_by              TEXT,

  -- Constraints
  CONSTRAINT corpus_indexes_document_model_unique
    UNIQUE (document_id, embedding_model, embedding_model_version),
  CONSTRAINT corpus_indexes_dimensions_valid
    CHECK (embedding_dimensions > 0 AND embedding_dimensions <= 4096),
  CONSTRAINT corpus_indexes_chunk_count_positive
    CHECK (chunk_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_corpus_indexes_document
  ON corpus_indexes(document_id);

CREATE INDEX IF NOT EXISTS idx_corpus_indexes_corpus
  ON corpus_indexes(corpus_id, corpus_version);

COMMENT ON TABLE corpus_indexes IS
  'Index provenance tracking per spec-corpus-retrieval.md §3.3. '
  'One row per embedding run. Audit trail for model, config, integrity.';
