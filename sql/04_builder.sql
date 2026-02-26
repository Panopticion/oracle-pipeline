-- =============================================================================
-- 04_builder.sql — Corpus builder: domains, sources, state axes, versions
--                  + RLS + views
-- =============================================================================
-- Depends on: 00_roles.sql, 01_extensions.sql, 02_console.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: user_org_ids() — returns current user's organization IDs.
-- Called once per transaction instead of per-row in RLS subqueries.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM organization_members
  WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: user_admin_org_ids() — orgs where user is owner or admin.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION user_admin_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM organization_members
  WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid
    AND role IN ('owner', 'admin');
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE corpus_source_type AS ENUM (
    'regulatory',
    'database',
    'standard',
    'documentation',
    'api'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE corpus_authority_level AS ENUM (
    'system_of_record',
    'authoritative',
    'advisory'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE corpus_domain_status AS ENUM (
    'draft',
    'review',
    'active',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE state_axis_type AS ENUM (
    'enum',
    'boolean',
    'range',
    'identifier',
    'timestamp',
    'validated_free'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Corpus Domains
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corpus_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status corpus_domain_status NOT NULL DEFAULT 'draft',
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  research_query TEXT,
  research_synthesis TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT corpus_domains_slug_unique UNIQUE (slug),
  CONSTRAINT corpus_domains_org_name_unique UNIQUE (organization_id, name),
  CONSTRAINT corpus_domains_version_positive CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS idx_corpus_domains_org ON corpus_domains(organization_id);
CREATE INDEX IF NOT EXISTS idx_corpus_domains_status ON corpus_domains(status);
CREATE INDEX IF NOT EXISTS idx_corpus_domains_slug ON corpus_domains(slug);

-- Slug generation (idempotent function + trigger)
CREATE OR REPLACE FUNCTION generate_corpus_domain_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.name = NEW.name THEN
      RETURN NEW;
    END IF;
    IF NEW.slug IS NOT NULL AND NEW.slug != '' AND NEW.slug != OLD.slug THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.slug IS NOT NULL AND NEW.slug != '' THEN
    RETURN NEW;
  END IF;

  base_slug := LOWER(REGEXP_REPLACE(TRIM(NEW.name), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := REGEXP_REPLACE(base_slug, '^-+|-+$', '', 'g');
  IF base_slug = '' OR base_slug IS NULL THEN
    base_slug := 'domain';
  END IF;

  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM corpus_domains WHERE slug = final_slug AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;

  NEW.slug := final_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_corpus_domain_slug ON corpus_domains;
CREATE TRIGGER set_corpus_domain_slug
  BEFORE INSERT OR UPDATE ON corpus_domains
  FOR EACH ROW
  EXECUTE FUNCTION generate_corpus_domain_slug();

DROP TRIGGER IF EXISTS update_corpus_domains_updated_at ON corpus_domains;
CREATE TRIGGER update_corpus_domains_updated_at
  BEFORE UPDATE ON corpus_domains
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Corpus Sources
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corpus_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES corpus_domains(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  description TEXT,
  source_type corpus_source_type NOT NULL DEFAULT 'documentation',
  authority_level corpus_authority_level NOT NULL DEFAULT 'advisory',
  authority_signals TEXT[] NOT NULL DEFAULT '{}',
  verifiable_claims TEXT[] NOT NULL DEFAULT '{}',
  query_capabilities TEXT[] NOT NULL DEFAULT '{}',
  evidence_quotes TEXT[] DEFAULT '{}',
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0.00 AND confidence <= 1.00),
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_connected BOOLEAN NOT NULL DEFAULT false,
  connection_config JSONB DEFAULT '{}',
  upstream_version TEXT,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT corpus_sources_domain_source_unique UNIQUE (domain_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_corpus_sources_domain ON corpus_sources(domain_id);
CREATE INDEX IF NOT EXISTS idx_corpus_sources_type ON corpus_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_corpus_sources_authority ON corpus_sources(authority_level);
CREATE INDEX IF NOT EXISTS idx_corpus_sources_active ON corpus_sources(domain_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS update_corpus_sources_updated_at ON corpus_sources;
CREATE TRIGGER update_corpus_sources_updated_at
  BEFORE UPDATE ON corpus_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- State Axes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corpus_state_axes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES corpus_domains(id) ON DELETE CASCADE,
  corpus_source_id UUID REFERENCES corpus_sources(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  axis_type state_axis_type NOT NULL DEFAULT 'validated_free',
  possible_values TEXT[],
  range_min DECIMAL,
  range_max DECIMAL,
  validation_pattern TEXT,
  is_required BOOLEAN NOT NULL DEFAULT false,
  extraction_prompt TEXT,
  default_value TEXT,
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0.00 AND confidence <= 1.00),
  evidence_quote TEXT,
  reasoning TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT corpus_state_axes_domain_key_unique UNIQUE (domain_id, key),
  CONSTRAINT corpus_state_axes_range_valid CHECK (
    axis_type != 'range' OR (range_min IS NOT NULL AND range_max IS NOT NULL AND range_min <= range_max)
  ),
  CONSTRAINT corpus_state_axes_enum_valid CHECK (
    axis_type != 'enum' OR (possible_values IS NOT NULL AND array_length(possible_values, 1) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_corpus_state_axes_domain ON corpus_state_axes(domain_id);
CREATE INDEX IF NOT EXISTS idx_corpus_state_axes_corpus ON corpus_state_axes(corpus_source_id);
CREATE INDEX IF NOT EXISTS idx_corpus_state_axes_required ON corpus_state_axes(domain_id) WHERE is_required = true;

DROP TRIGGER IF EXISTS update_corpus_state_axes_updated_at ON corpus_state_axes;
CREATE TRIGGER update_corpus_state_axes_updated_at
  BEFORE UPDATE ON corpus_state_axes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Domain Version History
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corpus_domain_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES corpus_domains(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'published', 'archived')),
  change_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT corpus_domain_versions_unique UNIQUE (domain_id, version)
);

CREATE INDEX IF NOT EXISTS idx_corpus_domain_versions_domain ON corpus_domain_versions(domain_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE corpus_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_state_axes ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_domain_versions ENABLE ROW LEVEL SECURITY;

-- ── pipeline_admin (full access) ────────────────────────────────────────────

DROP POLICY IF EXISTS "pipeline_admin_all_corpus_domains" ON corpus_domains;
CREATE POLICY "pipeline_admin_all_corpus_domains" ON corpus_domains FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_corpus_sources" ON corpus_sources;
CREATE POLICY "pipeline_admin_all_corpus_sources" ON corpus_sources FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_corpus_state_axes" ON corpus_state_axes;
CREATE POLICY "pipeline_admin_all_corpus_state_axes" ON corpus_state_axes FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_corpus_domain_versions" ON corpus_domain_versions;
CREATE POLICY "pipeline_admin_all_corpus_domain_versions" ON corpus_domain_versions FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

-- ── pipeline_user: corpus_domains ───────────────────────────────────────────

DROP POLICY IF EXISTS "users_read_own_org_domains" ON corpus_domains;
CREATE POLICY "users_read_own_org_domains" ON corpus_domains FOR SELECT TO pipeline_user
  USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "users_manage_own_org_domains" ON corpus_domains;
CREATE POLICY "users_manage_own_org_domains" ON corpus_domains FOR ALL TO pipeline_user
  USING (organization_id IN (SELECT user_admin_org_ids()))
  WITH CHECK (organization_id IN (SELECT user_admin_org_ids()));

DROP POLICY IF EXISTS "public_read_demo_domains" ON corpus_domains;
CREATE POLICY "public_read_demo_domains" ON corpus_domains FOR SELECT TO pipeline_anon
  USING (organization_id IS NULL AND status = 'active');

-- ── pipeline_user: corpus_sources ───────────────────────────────────────────

DROP POLICY IF EXISTS "users_read_own_org_sources" ON corpus_sources;
CREATE POLICY "users_read_own_org_sources" ON corpus_sources FOR SELECT TO pipeline_user
  USING (domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IN (SELECT user_org_ids())
  ));

DROP POLICY IF EXISTS "users_manage_own_org_sources" ON corpus_sources;
CREATE POLICY "users_manage_own_org_sources" ON corpus_sources FOR ALL TO pipeline_user
  USING (domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IN (SELECT user_admin_org_ids())
  ))
  WITH CHECK (domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IN (SELECT user_admin_org_ids())
  ));

DROP POLICY IF EXISTS "public_read_demo_sources" ON corpus_sources;
CREATE POLICY "public_read_demo_sources" ON corpus_sources FOR SELECT TO pipeline_anon
  USING (is_active = true AND domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IS NULL AND status = 'active'
  ));

-- ── pipeline_user: corpus_state_axes ────────────────────────────────────────

DROP POLICY IF EXISTS "users_read_own_org_axes" ON corpus_state_axes;
CREATE POLICY "users_read_own_org_axes" ON corpus_state_axes FOR SELECT TO pipeline_user
  USING (domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IN (SELECT user_org_ids())
  ));

DROP POLICY IF EXISTS "users_manage_own_org_axes" ON corpus_state_axes;
CREATE POLICY "users_manage_own_org_axes" ON corpus_state_axes FOR ALL TO pipeline_user
  USING (domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IN (SELECT user_admin_org_ids())
  ))
  WITH CHECK (domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IN (SELECT user_admin_org_ids())
  ));

DROP POLICY IF EXISTS "public_read_demo_axes" ON corpus_state_axes;
CREATE POLICY "public_read_demo_axes" ON corpus_state_axes FOR SELECT TO pipeline_anon
  USING (domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IS NULL AND status = 'active'
  ));

-- ── Version history: append-only for pipeline_user, read for members ────────

DROP POLICY IF EXISTS "users_read_own_org_versions" ON corpus_domain_versions;
CREATE POLICY "users_read_own_org_versions" ON corpus_domain_versions FOR SELECT TO pipeline_user
  USING (domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IN (SELECT user_org_ids())
  ));

DROP POLICY IF EXISTS "users_manage_own_org_versions" ON corpus_domain_versions;
CREATE POLICY "users_manage_own_org_versions" ON corpus_domain_versions FOR INSERT TO pipeline_user
  WITH CHECK (domain_id IN (
    SELECT id FROM corpus_domains WHERE organization_id IN (SELECT user_admin_org_ids())
  ));

DROP POLICY IF EXISTS "deny_update_versions" ON corpus_domain_versions;
CREATE POLICY "deny_update_versions" ON corpus_domain_versions AS RESTRICTIVE
  FOR UPDATE TO pipeline_user USING (false);

DROP POLICY IF EXISTS "deny_delete_versions" ON corpus_domain_versions;
CREATE POLICY "deny_delete_versions" ON corpus_domain_versions AS RESTRICTIVE
  FOR DELETE TO pipeline_user USING (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- Credential-safe view: corpus_sources without connection_config
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW corpus_sources_safe AS
SELECT
  id, domain_id, source_id, source_name, source_url, description,
  source_type, authority_level, authority_signals,
  verifiable_claims, query_capabilities, evidence_quotes,
  confidence, is_active, is_connected,
  upstream_version, last_verified_at, created_at, updated_at
FROM corpus_sources;

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE corpus_domains IS 'RFC-0002: Domain knowledge bases for AI governance';
COMMENT ON TABLE corpus_sources IS 'RFC-0002: Authoritative sources that verify claims';
COMMENT ON TABLE corpus_state_axes IS 'State dimensions derived from corpus capabilities';
COMMENT ON TABLE corpus_domain_versions IS 'Version history and audit trail';
COMMENT ON COLUMN corpus_sources.connection_config IS 'SENSITIVE: API credentials. Use Vault in production.';
