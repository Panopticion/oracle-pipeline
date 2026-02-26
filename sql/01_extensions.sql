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
