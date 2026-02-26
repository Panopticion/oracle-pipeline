-- =============================================================================
-- 03_sovereignty.sql — VPC sovereignty infrastructure
--                      Egress policies + embedding authorities
-- =============================================================================
-- Depends on: 00_roles.sql, 01_extensions.sql
-- =============================================================================

-- ── Egress policy registry (immutable versions) ────────────────────────────

CREATE TABLE IF NOT EXISTS egress_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,             -- e.g. "vpc-no-public-egress-v1"
  scope         text NOT NULL DEFAULT 'vpc',      -- fixed for this tier
  policy_hash   text NOT NULL,                    -- sha256 of the deployed policy artifact
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Append-only intent (pipeline_admin can insert; nobody updates/deletes)
ALTER TABLE egress_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_admin_all_egress_policies" ON egress_policies;
CREATE POLICY "pipeline_admin_all_egress_policies" ON egress_policies
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "deny_update_egress_policies" ON egress_policies;
CREATE POLICY "deny_update_egress_policies" ON egress_policies AS RESTRICTIVE
  FOR UPDATE TO pipeline_user USING (false);

DROP POLICY IF EXISTS "deny_delete_egress_policies" ON egress_policies;
CREATE POLICY "deny_delete_egress_policies" ON egress_policies AS RESTRICTIVE
  FOR DELETE TO pipeline_user USING (false);

COMMENT ON TABLE egress_policies IS
  'Immutable registry of network egress policy versions. Each row records the '
  'sha256 hash of the deployed infra artifact (Terraform plan, SG rule bundle). '
  'Append-only: pipeline_admin inserts; update/delete denied by RLS.';

-- ── Embedding authority registry (allowed embedder identities) ──────────────

CREATE TABLE IF NOT EXISTS embedding_authorities (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL UNIQUE,               -- "embedder-worker-prod-01"
  environment             text NOT NULL DEFAULT 'vpc',        -- fixed for this tier
  owner                   text,
  is_active               boolean NOT NULL DEFAULT true,

  -- Identifiers (auditable metadata; not 'security' by itself)
  instance_id             text,
  container_image_digest  text,                               -- sha256:...
  notes                   text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS embedding_authorities_updated_at ON embedding_authorities;
CREATE TRIGGER embedding_authorities_updated_at
  BEFORE UPDATE ON embedding_authorities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE embedding_authorities IS
  'Registry of approved embedding producer identities. Every embedding is attributed '
  'to an authority. Only registered, active authorities can author embeddings.';
