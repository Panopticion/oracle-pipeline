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
