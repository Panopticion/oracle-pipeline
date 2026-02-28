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
  } else if (path.startsWith("/encyclopedia")) {
    crumbs.push({ label: "Encyclopedia" });
  } else if (path.startsWith("/state")) {
    crumbs.push({ label: "Global State" });
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

  const navItems = [
    { to: "/sessions", label: "Sessions" },
    { to: "/encyclopedia", label: "Encyclopedia" },
    { to: "/state", label: "Global State" },
  ] as const;

  async function handleSignOut() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-alt">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
            >
              <span className="text-lg font-semibold tracking-tight text-text">
                Panopticon
              </span>
              <span className="text-xs text-text-muted">Corpus Pipeline</span>
            </Link>
            <nav className="flex items-center gap-1" aria-label="Primary">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-alt hover:text-text"
                  activeProps={{
                    className: "rounded-md bg-corpus-100 px-3 py-1.5 text-sm font-medium text-corpus-700",
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="text-xs text-text-muted">{user.email}</span>
            <button
              onClick={handleSignOut}
              className="rounded-md px-2 py-1 text-sm text-text-muted transition-colors hover:bg-surface-alt hover:text-text"
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

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-6 sm:flex-row">
          <p className="text-xs text-text-muted">
            &copy; 2025 Panopticon AI. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a
              href="https://panopticonlabs.ai/privacy"
              className="text-xs text-text-muted transition-colors hover:text-text"
            >
              Privacy
            </a>
            <a
              href="https://panopticonlabs.ai/terms"
              className="text-xs text-text-muted transition-colors hover:text-text"
            >
              Terms
            </a>
            <a
              href="https://github.com/Panopticion/corpus-tools"
              className="text-xs text-text-muted transition-colors hover:text-text"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
