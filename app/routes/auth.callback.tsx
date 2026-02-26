import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

/**
 * Auth callback handler.
 *
 * Supabase redirects here after:
 * - Email confirmation (signup)
 * - Magic link sign in
 * - Password reset (recovery)
 * - Email change confirmation
 * - Invite acceptance
 *
 * The Supabase client auto-detects the hash fragment and exchanges it
 * for a session. We then redirect based on the auth event type.
 */
function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        // User clicked reset password link — send to update password page
        window.location.href = "/auth/update-password";
      } else if (
        event === "SIGNED_IN" ||
        event === "USER_UPDATED" ||
        event === "TOKEN_REFRESHED"
      ) {
        // Successful auth — redirect to app
        window.location.href = "/sessions";
      } else if (event === "SIGNED_OUT") {
        window.location.href = "/auth/login";
      }
    });

    // Also handle the case where the hash is processed immediately
    const hash = window.location.hash;
    if (!hash) {
      // No hash fragment — check URL params for error
      const params = new URLSearchParams(window.location.search);
      const errorDesc = params.get("error_description");
      if (errorDesc) {
        setError(errorDesc);
      } else {
        // No hash, no error — just redirect
        window.location.href = "/sessions";
      }
    }
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-alt">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm">
          <h1 className="mb-2 text-xl font-semibold text-text">
            Authentication error
          </h1>
          <p className="mb-4 text-sm text-error">{error}</p>
          <a
            href="/auth/login"
            className="text-sm text-corpus-600 hover:underline"
          >
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-alt">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        <p className="text-sm text-text-muted">Completing sign in...</p>
      </div>
    </div>
  );
}
