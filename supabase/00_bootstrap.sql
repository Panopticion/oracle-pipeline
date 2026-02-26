-- =============================================================================
-- Panopticon AI — Supabase Bootstrap Migration
-- =============================================================================
-- Generated single-file migration for Supabase-hosted Postgres.
--
-- Adaptations from the vanilla sql/ files:
--   1. Custom roles (pipeline_admin/user/anon) granted to Supabase built-ins
--   2. auth.users → public.users sync trigger for FK compatibility
--   3. pgvector extension enabled in extensions schema
--
-- Run via psql or paste into the Supabase SQL editor.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 00_roles.sql — Database roles and minimal users table
-- =============================================================================
-- Creates the three roles used by RLS policies and grants:
--   pipeline_admin  — full access (used by server-side API routes / CLI)
--   pipeline_user   — authenticated end-user (JWT sub claim set by PostgREST)
--   pipeline_anon   — unauthenticated / public read
--
-- Also creates a minimal `users` table to replace Supabase's `auth.users`.
-- In production, replace or federate this with your auth provider's user store.
--
-- PostgREST compatibility:
--   PostgREST sets `request.jwt.claim.sub` and `request.jwt.claim.role`
--   on every connection. All RLS policies use current_setting() to read these.
--   If using psql directly, SET LOCAL before queries:
--     SET LOCAL request.jwt.claim.sub = '<user-uuid>';
--     SET LOCAL request.jwt.claim.role = 'pipeline_admin';
-- =============================================================================

-- Roles (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pipeline_admin') THEN
    CREATE ROLE pipeline_admin NOLOGIN;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pipeline_user') THEN
    CREATE ROLE pipeline_user NOLOGIN;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pipeline_anon') THEN
    CREATE ROLE pipeline_anon NOLOGIN;
  END IF;
END $$;

-- Minimal users table (replaces Supabase auth.users)
-- Extend as needed for your auth provider.
CREATE TABLE IF NOT EXISTS users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS
  'Minimal user identity table. Replace or federate with your auth provider. '
  'All FK references in the schema point here instead of auth.users.';

-- Grant schema usage so PostgREST can switch to these roles
GRANT USAGE ON SCHEMA public TO pipeline_admin, pipeline_user, pipeline_anon;

-- =============================================================================
-- SUPABASE ROLE MAPPING
-- =============================================================================
-- Map pipeline roles to Supabase built-in roles so PostgREST role switching
-- inherits all RLS policies and grants.
--   service_role  → pipeline_admin (full access, bypasses RLS anyway)
--   authenticated → pipeline_user  (JWT-scoped, org-gated)
--   anon          → pipeline_anon  (public read-only)
-- =============================================================================

GRANT pipeline_admin TO service_role;
GRANT pipeline_user TO authenticated;
GRANT pipeline_anon TO anon;

-- =============================================================================
-- AUTH.USERS → PUBLIC.USERS SYNC TRIGGER
-- =============================================================================
-- Supabase Auth manages users in auth.users. The pipeline schema has FKs
-- pointing to public.users. This trigger keeps them in sync on signup.
-- =============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at)
  VALUES (NEW.id, NEW.email, NEW.created_at)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- =============================================================================
-- 01_extensions.sql — PostgreSQL extensions and utility functions
-- =============================================================================
-- Depends on: 00_roles.sql
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;


-- =============================================================================
-- UUIDv7: Time-ordered UUIDs for append-heavy tables (RFC 9562 §5.7)
-- =============================================================================
-- gen_random_uuid() (UUIDv4) creates random PKs that cause B-tree page
-- fragmentation on append-heavy tables. UUIDv7 embeds a 48-bit millisecond
-- timestamp in the high bits, ensuring sequential index writes and enabling
-- time-range queries on the PK directly.

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  v_time  BIGINT;
  v_bytes BYTEA;
BEGIN
  v_time := (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;

  v_bytes := set_byte(
    set_byte(
      set_byte(
        set_byte(
          set_byte(
            set_byte(
              gen_random_bytes(16),
              0, ((v_time >> 40) & 255)::INTEGER
            ),
            1, ((v_time >> 32) & 255)::INTEGER
          ),
          2, ((v_time >> 24) & 255)::INTEGER
        ),
        3, ((v_time >> 16) & 255)::INTEGER
      ),
      4, ((v_time >> 8) & 255)::INTEGER
    ),
    5, (v_time & 255)::INTEGER
  );

  v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 112);
  v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);

  RETURN encode(v_bytes, 'hex')::UUID;
END;
$$;

COMMENT ON FUNCTION uuid_generate_v7 IS
  'RFC 9562 §5.7 UUIDv7: time-ordered UUID with 48-bit ms timestamp + 74 bits random. '
  'Ensures sequential B-tree index writes for append-heavy tables.';


-- =============================================================================
-- update_updated_at_column() — shared trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 02_console.sql — Console schema: organizations, members, projects,
--                  ontologies, policies, audit logs + RLS + triggers
-- =============================================================================
-- Depends on: 00_roles.sql, 01_extensions.sql
-- =============================================================================

-- =============================================================================
-- ENUMS (idempotent)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ontology_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE policy_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE policy_action AS ENUM ('AUTHORIZED', 'BLOCKED', 'NEEDS_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_status AS ENUM ('AUTHORIZED', 'BLOCKED', 'NEEDS_REVIEW', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- ORGANIZATIONS (multi-tenant root)
-- =============================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS organizations_slug_idx ON organizations (slug);

-- =============================================================================
-- ORGANIZATION MEMBERS (user-org relationship)
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role organization_role NOT NULL DEFAULT 'member',
  created_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT organization_members_unique UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_members_org_idx ON organization_members (organization_id);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members (user_id);

-- =============================================================================
-- PROJECTS (belongs to organization)
-- =============================================================================

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT projects_org_slug_unique UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS projects_org_idx ON projects (organization_id);
CREATE INDEX IF NOT EXISTS projects_slug_idx ON projects (slug);

-- =============================================================================
-- PROJECT ONTOLOGIES (versioned, per project — enterprise console graph editor)
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_ontologies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  version integer NOT NULL DEFAULT 1,
  status ontology_status NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS project_ontologies_project_idx ON project_ontologies (project_id);
CREATE INDEX IF NOT EXISTS project_ontologies_status_idx ON project_ontologies (status);

-- =============================================================================
-- ONTOLOGY NODES (graph vertices)
-- =============================================================================

CREATE TABLE IF NOT EXISTS ontology_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ontology_id uuid NOT NULL REFERENCES project_ontologies(id) ON DELETE CASCADE,
  node_type text NOT NULL,
  label text NOT NULL,
  description text,
  attributes jsonb NOT NULL DEFAULT '{}',
  position_x real,
  position_y real,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS ontology_nodes_ontology_idx ON ontology_nodes (ontology_id);
CREATE INDEX IF NOT EXISTS ontology_nodes_type_idx ON ontology_nodes (node_type);

-- =============================================================================
-- ONTOLOGY EDGES (graph edges)
-- =============================================================================

CREATE TABLE IF NOT EXISTS ontology_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ontology_id uuid NOT NULL REFERENCES project_ontologies(id) ON DELETE CASCADE,
  source_node_id uuid NOT NULL REFERENCES ontology_nodes(id) ON DELETE CASCADE,
  target_node_id uuid NOT NULL REFERENCES ontology_nodes(id) ON DELETE CASCADE,
  edge_type text NOT NULL,
  label text,
  attributes jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT ontology_edges_no_self_loop CHECK (source_node_id != target_node_id)
);

CREATE INDEX IF NOT EXISTS ontology_edges_ontology_idx ON ontology_edges (ontology_id);
CREATE INDEX IF NOT EXISTS ontology_edges_source_idx ON ontology_edges (source_node_id);
CREATE INDEX IF NOT EXISTS ontology_edges_target_idx ON ontology_edges (target_node_id);

-- =============================================================================
-- POLICIES (authority rules per project)
-- =============================================================================

CREATE TABLE IF NOT EXISTS policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status policy_status NOT NULL DEFAULT 'active',
  conditions jsonb NOT NULL DEFAULT '{}',
  action policy_action NOT NULL DEFAULT 'NEEDS_REVIEW',
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS policies_project_idx ON policies (project_id);
CREATE INDEX IF NOT EXISTS policies_status_idx ON policies (status);
CREATE INDEX IF NOT EXISTS policies_priority_idx ON policies (priority DESC);

-- =============================================================================
-- AUDIT LOGS (AI decision records)
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  input_summary jsonb,
  output_summary jsonb,
  status audit_status NOT NULL,
  policy_id uuid REFERENCES policies(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs (organization_id);
CREATE INDEX IF NOT EXISTS audit_logs_project_idx ON audit_logs (project_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_status_idx ON audit_logs (status);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_ontologies ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ── pipeline_admin (full access for API routes) ─────────────────────────────

DROP POLICY IF EXISTS "pipeline_admin_all_organizations" ON organizations;
CREATE POLICY "pipeline_admin_all_organizations" ON organizations
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_organization_members" ON organization_members;
CREATE POLICY "pipeline_admin_all_organization_members" ON organization_members
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_projects" ON projects;
CREATE POLICY "pipeline_admin_all_projects" ON projects
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_project_ontologies" ON project_ontologies;
CREATE POLICY "pipeline_admin_all_project_ontologies" ON project_ontologies
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_ontology_nodes" ON ontology_nodes;
CREATE POLICY "pipeline_admin_all_ontology_nodes" ON ontology_nodes
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_ontology_edges" ON ontology_edges;
CREATE POLICY "pipeline_admin_all_ontology_edges" ON ontology_edges
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_policies" ON policies;
CREATE POLICY "pipeline_admin_all_policies" ON policies
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_audit_logs" ON audit_logs;
CREATE POLICY "pipeline_admin_all_audit_logs" ON audit_logs
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

-- ── Organizations ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT TO pipeline_user
  USING (
    id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid)
  );

DROP POLICY IF EXISTS "Owners can update organizations" ON organizations;
CREATE POLICY "Owners can update organizations"
  ON organizations FOR UPDATE TO pipeline_user
  USING (
    id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid AND role = 'owner')
  )
  WITH CHECK (
    id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid AND role = 'owner')
  );

-- ── Organization Members ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view org members" ON organization_members;
CREATE POLICY "Users can view org members"
  ON organization_members FOR SELECT TO pipeline_user
  USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid)
  );

DROP POLICY IF EXISTS "Admins can manage org members" ON organization_members;
CREATE POLICY "Admins can manage org members"
  ON organization_members FOR ALL TO pipeline_user
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid AND role IN ('owner', 'admin')
    )
  );

-- ── Projects ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view org projects" ON projects;
CREATE POLICY "Users can view org projects"
  ON projects FOR SELECT TO pipeline_user
  USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid)
  );

DROP POLICY IF EXISTS "Members can manage projects" ON projects;
CREATE POLICY "Members can manage projects"
  ON projects FOR ALL TO pipeline_user
  USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid)
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid)
  );

-- ── Project Ontologies ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view project ontologies" ON project_ontologies;
CREATE POLICY "Users can view project ontologies"
  ON project_ontologies FOR SELECT TO pipeline_user
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  );

DROP POLICY IF EXISTS "Members can manage project ontologies" ON project_ontologies;
CREATE POLICY "Members can manage project ontologies"
  ON project_ontologies FOR ALL TO pipeline_user
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  );

-- ── Ontology Nodes ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view ontology nodes" ON ontology_nodes;
CREATE POLICY "Users can view ontology nodes"
  ON ontology_nodes FOR SELECT TO pipeline_user
  USING (
    ontology_id IN (
      SELECT o.id FROM project_ontologies o
      JOIN projects p ON p.id = o.project_id
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  );

DROP POLICY IF EXISTS "Members can manage ontology nodes" ON ontology_nodes;
CREATE POLICY "Members can manage ontology nodes"
  ON ontology_nodes FOR ALL TO pipeline_user
  USING (
    ontology_id IN (
      SELECT o.id FROM project_ontologies o
      JOIN projects p ON p.id = o.project_id
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  )
  WITH CHECK (
    ontology_id IN (
      SELECT o.id FROM project_ontologies o
      JOIN projects p ON p.id = o.project_id
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  );

-- ── Ontology Edges ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view ontology edges" ON ontology_edges;
CREATE POLICY "Users can view ontology edges"
  ON ontology_edges FOR SELECT TO pipeline_user
  USING (
    ontology_id IN (
      SELECT o.id FROM project_ontologies o
      JOIN projects p ON p.id = o.project_id
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  );

DROP POLICY IF EXISTS "Members can manage ontology edges" ON ontology_edges;
CREATE POLICY "Members can manage ontology edges"
  ON ontology_edges FOR ALL TO pipeline_user
  USING (
    ontology_id IN (
      SELECT o.id FROM project_ontologies o
      JOIN projects p ON p.id = o.project_id
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  )
  WITH CHECK (
    ontology_id IN (
      SELECT o.id FROM project_ontologies o
      JOIN projects p ON p.id = o.project_id
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  );

-- ── Policies (authority rules) ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view policies" ON policies;
CREATE POLICY "Users can view policies"
  ON policies FOR SELECT TO pipeline_user
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  );

DROP POLICY IF EXISTS "Members can manage policies" ON policies;
CREATE POLICY "Members can manage policies"
  ON policies FOR ALL TO pipeline_user
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  );

-- ── Audit Logs ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view audit logs" ON audit_logs;
CREATE POLICY "Users can view audit logs"
  ON audit_logs FOR SELECT TO pipeline_user
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claim.sub', true)::uuid
    )
  );

-- =============================================================================
-- UPDATED_AT TRIGGERS (idempotent)
-- =============================================================================

DROP TRIGGER IF EXISTS organizations_updated_at ON organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS project_ontologies_updated_at ON project_ontologies;
CREATE TRIGGER project_ontologies_updated_at
  BEFORE UPDATE ON project_ontologies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS ontology_nodes_updated_at ON ontology_nodes;
CREATE TRIGGER ontology_nodes_updated_at
  BEFORE UPDATE ON ontology_nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS policies_updated_at ON policies;
CREATE TRIGGER policies_updated_at
  BEFORE UPDATE ON policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

-- =============================================================================
-- 06_rls.sql — Row-level security for corpus content store
-- =============================================================================
-- Depends on: 04_builder.sql (user_org_ids), 05_content.sql
-- =============================================================================

-- Enable RLS
ALTER TABLE corpus_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_indexes ENABLE ROW LEVEL SECURITY;

-- pipeline_admin: full access
DROP POLICY IF EXISTS "pipeline_admin_all_corpus_documents" ON corpus_documents;
CREATE POLICY "pipeline_admin_all_corpus_documents"
  ON corpus_documents FOR ALL TO pipeline_admin
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_corpus_chunks" ON corpus_chunks;
CREATE POLICY "pipeline_admin_all_corpus_chunks"
  ON corpus_chunks FOR ALL TO pipeline_admin
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_all_corpus_indexes" ON corpus_indexes;
CREATE POLICY "pipeline_admin_all_corpus_indexes"
  ON corpus_indexes FOR ALL TO pipeline_admin
  USING (true) WITH CHECK (true);

-- ── corpus_documents (org-scoped) ──────────────────────────────────────────

DROP POLICY IF EXISTS "pipeline_user_read_corpus_documents" ON corpus_documents;
CREATE POLICY "pipeline_user_read_corpus_documents"
  ON corpus_documents FOR SELECT TO pipeline_user
  USING (
    is_active = true
    AND (
      organization_id IS NULL                          -- platform corpus
      OR organization_id IN (SELECT user_org_ids())    -- customer corpus
    )
  );

DROP POLICY IF EXISTS "pipeline_anon_read_corpus_documents" ON corpus_documents;
CREATE POLICY "pipeline_anon_read_corpus_documents"
  ON corpus_documents FOR SELECT TO pipeline_anon
  USING (is_active = true AND organization_id IS NULL);

-- ── corpus_chunks (org-scoped) ─────────────────────────────────────────────

DROP POLICY IF EXISTS "pipeline_user_read_corpus_chunks" ON corpus_chunks;
CREATE POLICY "pipeline_user_read_corpus_chunks"
  ON corpus_chunks FOR SELECT TO pipeline_user
  USING (
    document_id IN (
      SELECT id FROM corpus_documents
      WHERE is_active = true
        AND (
          organization_id IS NULL
          OR organization_id IN (SELECT user_org_ids())
        )
    )
  );

DROP POLICY IF EXISTS "pipeline_anon_read_corpus_chunks" ON corpus_chunks;
CREATE POLICY "pipeline_anon_read_corpus_chunks"
  ON corpus_chunks FOR SELECT TO pipeline_anon
  USING (
    document_id IN (
      SELECT id FROM corpus_documents
      WHERE is_active = true AND organization_id IS NULL
    )
  );

-- ── corpus_indexes (org-scoped) ────────────────────────────────────────────

DROP POLICY IF EXISTS "pipeline_user_read_corpus_indexes" ON corpus_indexes;
CREATE POLICY "pipeline_user_read_corpus_indexes"
  ON corpus_indexes FOR SELECT TO pipeline_user
  USING (
    document_id IN (
      SELECT id FROM corpus_documents
      WHERE is_active = true
        AND (
          organization_id IS NULL
          OR organization_id IN (SELECT user_org_ids())
        )
    )
  );

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

-- =============================================================================
-- 09_envelopes.sql — Pipeline envelopes + embedding event log + RLS
-- =============================================================================
-- Depends on: 00_roles.sql, 03_sovereignty.sql, 05_content.sql
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════════
-- PIPELINE ENVELOPES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS corpus_pipeline_envelopes (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  run_id        uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Who triggered it
  triggered_by  text NOT NULL,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,

  -- What action
  action        text NOT NULL,
  corpus_id     text,

  -- Pipeline results (per-corpus JSONB)
  validation    jsonb,
  ingestion     jsonb,
  embedding     jsonb,

  -- Denormalized for quick filtering
  validation_valid  boolean,
  ingestion_action  text,
  chunk_count       int,
  embedded_count    int,

  -- Timing
  started_at    timestamptz NOT NULL,
  completed_at  timestamptz,
  duration_ms   int,

  -- Error (if pipeline threw)
  error         text,

  -- Rechunk metadata (when action = rechunk)
  rechunk_meta  jsonb,

  -- VPC sovereignty bindings (denormalized from run attestation)
  organization_id         uuid REFERENCES organizations(id) ON DELETE SET NULL,
  embedding_authority_id   uuid REFERENCES embedding_authorities(id),
  egress_policy_id         uuid REFERENCES egress_policies(id),
  attestation_run_id       uuid REFERENCES corpus_pipeline_run_attestations(run_id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX idx_pipeline_envelopes_run_id
  ON corpus_pipeline_envelopes (run_id);
CREATE INDEX idx_pipeline_envelopes_corpus_id
  ON corpus_pipeline_envelopes (corpus_id);
CREATE INDEX idx_pipeline_envelopes_created_at
  ON corpus_pipeline_envelopes (created_at DESC);
CREATE INDEX idx_pipeline_envelopes_triggered_by
  ON corpus_pipeline_envelopes (triggered_by);
CREATE INDEX idx_pipeline_envelopes_action
  ON corpus_pipeline_envelopes (ingestion_action);
CREATE INDEX IF NOT EXISTS idx_pipeline_env_att_run
  ON corpus_pipeline_envelopes (attestation_run_id);

-- Comments
COMMENT ON TABLE corpus_pipeline_envelopes
  IS 'Observability trail for corpus pipeline runs. One row per corpus per run.';
COMMENT ON COLUMN corpus_pipeline_envelopes.run_id
  IS 'UUID grouping all corpora processed in a single pipeline invocation.';
COMMENT ON COLUMN corpus_pipeline_envelopes.triggered_by
  IS 'Source of the pipeline run: cli, admin-ui, or corpus-builder.';
COMMENT ON COLUMN corpus_pipeline_envelopes.rechunk_meta
  IS 'Metadata for rechunk operations: old_chunk_count, new_chunk_count, changed_sections.';

-- RLS
ALTER TABLE corpus_pipeline_envelopes ENABLE ROW LEVEL SECURITY;

-- pipeline_admin can do everything (used by API route and CLI)
CREATE POLICY "pipeline_admin_full_access" ON corpus_pipeline_envelopes
  FOR ALL TO pipeline_admin
  USING (true) WITH CHECK (true);

-- Summary view for admin console
CREATE OR REPLACE VIEW corpus_pipeline_envelope_summary AS
SELECT
  e.run_id,
  e.action,
  e.triggered_by,
  e.user_id,
  min(e.created_at) AS started_at,
  max(e.completed_at) AS completed_at,
  count(*) AS corpus_count,
  count(*) FILTER (WHERE e.validation_valid) AS valid_count,
  count(*) FILTER (WHERE e.ingestion_action IN ('inserted', 'updated')) AS ingested_count,
  coalesce(sum(e.embedded_count), 0) AS total_embedded,
  count(*) FILTER (WHERE e.error IS NOT NULL) AS error_count,
  max(e.duration_ms) AS max_duration_ms
FROM corpus_pipeline_envelopes e
GROUP BY e.run_id, e.action, e.triggered_by, e.user_id
ORDER BY min(e.created_at) DESC;

COMMENT ON VIEW corpus_pipeline_envelope_summary
  IS 'Aggregated view of pipeline runs for the admin console.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- EMBEDDING EVENT LOG (append-only forensics)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS corpus_embedding_events (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  occurred_at             timestamptz NOT NULL DEFAULT now(),

  run_id                  uuid NOT NULL REFERENCES corpus_pipeline_run_attestations(run_id) ON DELETE CASCADE,
  embedding_authority_id  uuid NOT NULL REFERENCES embedding_authorities(id),

  chunk_id                uuid NOT NULL REFERENCES corpus_chunks(id) ON DELETE CASCADE,
  document_id             uuid NOT NULL REFERENCES corpus_documents(id) ON DELETE CASCADE,

  chunk_content_hash      text NOT NULL,
  embedding_model         text NOT NULL,
  embedding_model_version text,

  status                  text NOT NULL CHECK (status IN ('complete', 'failed')),
  error                   text
);

CREATE INDEX IF NOT EXISTS idx_corpus_embedding_events_run
  ON corpus_embedding_events (run_id);

CREATE INDEX IF NOT EXISTS idx_corpus_embedding_events_chunk
  ON corpus_embedding_events (chunk_id);

-- Append-only (pipeline_admin inserts + selects; deny update/delete)
ALTER TABLE corpus_embedding_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_admin_insert_embedding_events" ON corpus_embedding_events;
CREATE POLICY "pipeline_admin_insert_embedding_events" ON corpus_embedding_events
  FOR INSERT TO pipeline_admin WITH CHECK (true);

DROP POLICY IF EXISTS "pipeline_admin_select_embedding_events" ON corpus_embedding_events;
CREATE POLICY "pipeline_admin_select_embedding_events" ON corpus_embedding_events
  FOR SELECT TO pipeline_admin USING (true);

DROP POLICY IF EXISTS "deny_update_embedding_events" ON corpus_embedding_events;
CREATE POLICY "deny_update_embedding_events" ON corpus_embedding_events AS RESTRICTIVE
  FOR UPDATE TO pipeline_user USING (false);

DROP POLICY IF EXISTS "deny_delete_embedding_events" ON corpus_embedding_events;
CREATE POLICY "deny_delete_embedding_events" ON corpus_embedding_events AS RESTRICTIVE
  FOR DELETE TO pipeline_user USING (false);

COMMENT ON TABLE corpus_embedding_events IS
  'Append-only forensic log of all embedding operations. Written by '
  'complete_corpus_chunk_embedding and fail_corpus_chunk_embedding. '
  'Prevents silent mutation and provides durable audit trail.';

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

-- =============================================================================
-- SEED: Default sovereignty records
-- =============================================================================
-- The pipeline requires at least one egress policy and one embedding authority
-- before it can embed anything.
-- =============================================================================

INSERT INTO egress_policies (name, scope, policy_hash, description, is_active)
VALUES ('supabase-hosted-v1', 'cloud', 'sha256:supabase-managed', 'Supabase-hosted deployment', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO embedding_authorities (name, environment, owner, is_active)
VALUES ('embedder-supabase-prod', 'cloud', 'panopticon', true)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 11_parse_drafts.sql — Document upload + AI parse staging table
-- =============================================================================

CREATE TABLE IF NOT EXISTS corpus_parse_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  source_filename TEXT NOT NULL,
  source_text     TEXT NOT NULL,
  source_hash     TEXT NOT NULL,
  parsed_markdown TEXT,
  parse_model     TEXT,
  parse_tokens_in INTEGER,
  parse_tokens_out INTEGER,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'parsing', 'parsed', 'approved', 'rejected', 'failed')),
  user_markdown   TEXT,
  reviewer_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewer_notes  TEXT,
  document_id     UUID REFERENCES corpus_documents(id) ON DELETE SET NULL,
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

ALTER TABLE corpus_parse_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_admin_all_parse_drafts" ON corpus_parse_drafts;
CREATE POLICY "pipeline_admin_all_parse_drafts" ON corpus_parse_drafts
  FOR ALL TO pipeline_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "users_read_own_org_parse_drafts" ON corpus_parse_drafts;
CREATE POLICY "users_read_own_org_parse_drafts" ON corpus_parse_drafts
  FOR SELECT TO pipeline_user
  USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "users_manage_own_org_parse_drafts" ON corpus_parse_drafts;
CREATE POLICY "users_manage_own_org_parse_drafts" ON corpus_parse_drafts
  FOR ALL TO pipeline_user
  USING (organization_id IN (SELECT user_admin_org_ids()))
  WITH CHECK (organization_id IN (SELECT user_admin_org_ids()));

COMMENT ON TABLE corpus_parse_drafts IS
  'Document upload + AI parse staging. Approved drafts become corpus_documents.';

COMMIT;
