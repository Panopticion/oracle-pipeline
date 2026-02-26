import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

export const Route = createFileRoute("/auth/signup")({
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabaseBrowser();
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    navigate({ to: "/sessions" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-alt">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-text">Create account</h1>
        <p className="mb-6 text-sm text-text-muted">
          Panopticon Corpus Pipeline
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-text"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-text"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
            />
            <p className="mt-1 text-xs text-text-muted">Minimum 8 characters</p>
          </div>

          {error && (
            <p className="text-sm text-error">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-corpus-600 px-4 py-2 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-text-muted leading-relaxed">
          By creating an account, you agree to our{" "}
          <a href="https://panopticonlabs.ai/terms" target="_blank" rel="noopener noreferrer" className="text-corpus-600 hover:underline">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="https://panopticonlabs.ai/privacy" target="_blank" rel="noopener noreferrer" className="text-corpus-600 hover:underline">
            Privacy Policy
          </a>
          .
        </p>

        <p className="mt-3 text-center text-sm text-text-muted">
          Have an account?{" "}
          <a href="/auth/login" className="text-corpus-600 hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
