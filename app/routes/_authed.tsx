import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useMatches,
} from "@tanstack/react-router";
import { getUser } from "@/server/session-actions";
import { getSupabaseBrowser } from "@/lib/supabase";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const user = await getUser();
    if (!user.authenticated) {
      throw redirect({ to: "/auth/login" });
    }
    return { user };
  },
  component: AuthedLayout,
});

// ─── Breadcrumbs ─────────────────────────────────────────────────────────────

function Breadcrumbs() {
  const location = useLocation();
  const matches = useMatches();
  const path = location.pathname;

  const crumbs: { label: string; href?: string }[] = [{ label: "Home", href: "/" }];

  if (path.startsWith("/sessions")) {
    // Session workspace — pull session name from loader data
    const sessionMatch = matches.find(
      (m) => m.id === "/_authed/sessions/$id",
    );
    if (sessionMatch) {
      crumbs.push({ label: "Sessions", href: "/sessions" });
      const loaderData = sessionMatch.loaderData as
        | { session?: { name?: string } }
        | undefined;
      const sessionName = loaderData?.session?.name ?? "Session";
      crumbs.push({ label: sessionName });
    } else {
      crumbs.push({ label: "Sessions" });
    }
  }

  if (crumbs.length <= 1) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="border-b border-border bg-surface-alt"
    >
      <ol className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-2 text-xs">
        {crumbs.map((crumb, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-text-muted/40">/</span>}
            {crumb.href && i < crumbs.length - 1 ? (
              <Link
                to={crumb.href}
                className="text-text-muted transition-colors hover:text-text"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium text-text">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────

function AuthedLayout() {
  const { user } = Route.useRouteContext();

  async function handleSignOut() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-alt">
      {/* Dark header — matches landing page */}
      <header className="bg-[#0f172a]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex items-center gap-2 transition-opacity hover:opacity-80"
            >
              <span className="text-lg font-semibold tracking-tight text-white">
                Panopticon
              </span>
              <span className="text-xs text-slate-400">Corpus Pipeline</span>
            </Link>
            <Link
              to="/sessions"
              className="text-sm text-slate-400 transition-colors hover:text-white"
            >
              Sessions
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400">{user.email}</span>
            <button
              onClick={handleSignOut}
              className="text-sm text-slate-400 transition-colors hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <Breadcrumbs />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>

      {/* Dark footer — matches landing page */}
      <footer className="bg-[#0f172a]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-6 sm:flex-row">
          <p className="text-xs text-slate-500">
            &copy; 2025 Panopticon AI. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a
              href="https://panopticonlabs.ai/privacy"
              className="text-xs text-slate-500 transition-colors hover:text-slate-300"
            >
              Privacy
            </a>
            <a
              href="https://panopticonlabs.ai/terms"
              className="text-xs text-slate-500 transition-colors hover:text-slate-300"
            >
              Terms
            </a>
            <a
              href="https://github.com/Panopticion/corpus-tools"
              className="text-xs text-slate-500 transition-colors hover:text-slate-300"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
