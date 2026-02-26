/**
 * Supabase client helpers for TanStack Start.
 *
 * - Browser client: used in client components
 * - Server client: used in server functions (reads cookies from request)
 * - Service client: uses service_role key (bypasses RLS)
 */

import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export class MissingEnvironmentError extends Error {
  missing: string[];

  constructor(missing: string[]) {
    super(
      `Missing required environment variables: ${missing.join(", ")}. Configure these in Vercel Project Settings > Environment Variables.`,
    );
    this.name = "MissingEnvironmentError";
    this.missing = missing;
  }
}

function assertEnvironmentVariables(names: string[]) {
  const missing = names.filter((name) => {
    const value = process.env[name];
    return !value || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new MissingEnvironmentError(missing);
  }
}

function assertBrowserEnvironmentVariables(names: string[]) {
  const missing = names.filter((name) => {
    const value = import.meta.env[name as keyof ImportMetaEnv];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new MissingEnvironmentError(missing);
  }
}

// ─── Browser client (client-side) ───────────────────────────────────────────

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowser() {
  if (browserClient) return browserClient;

  assertBrowserEnvironmentVariables([
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
  ]);

  browserClient = createBrowserClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );

  return browserClient;
}

// ─── Server client (server-side, uses request cookies for auth) ─────────────

export function getSupabaseServer(request: Request) {
  assertEnvironmentVariables(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]);

  const cookieHeader = request.headers.get("cookie") ?? "";

  // Parse cookies from header
  const cookies: { name: string; value: string }[] = cookieHeader
    .split(";")
    .filter(Boolean)
    .map((c) => {
      const idx = c.indexOf("=");
      if (idx === -1) return { name: c.trim(), value: "" };
      return { name: c.slice(0, idx).trim(), value: c.slice(idx + 1).trim() };
    });

  // Collect cookies to set on the response
  const cookiesToSet: {
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }[] = [];

  const client = createServerClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookies;
        },
        setAll(newCookies: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.push(...newCookies);
        },
      },
    },
  );

  return { client, cookiesToSet };
}

// ─── Service client (server-side, bypasses RLS) ─────────────────────────────

export function getSupabaseService() {
  assertEnvironmentVariables([
    "VITE_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);

  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
