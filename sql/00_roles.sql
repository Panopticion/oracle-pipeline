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
