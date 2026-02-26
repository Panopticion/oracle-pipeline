/**
 * Public read-only session view at /share/:id.
 *
 * No auth required — fetches session data via getPublicSessionData which
 * verifies is_public=true before returning. Strips source_text from docs.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { getPublicSessionData } from "@/server/session-actions";
import { useState } from "react";

const SITE_URL = "https://panopticonlabs.ai";

export const Route = createFileRoute("/share/$id")({
  loader: ({ params }) => getPublicSessionData({ data: { sessionId: params.id } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.session?.name ?? "Shared Session"} — Panopticon AI`,
      },
      {
        name: "description",
        content: `Public corpus session: ${loaderData?.session?.name ?? "Shared Session"} — AI-parsed compliance documents and cross-framework crosswalk.`,
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Home",
              item: SITE_URL,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: loaderData?.session?.name ?? "Shared Session",
            },
          ],
        }),
      },
    ],
  }),
  errorComponent: NotFound,
  component: PublicSessionView,
});

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-[#0f172a] text-white font-[Inter,system-ui,sans-serif]">
      <PublicHeader />
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold">Session not found</h1>
          <p className="mb-6 text-sm text-slate-400">
            This session may be private or may not exist.
          </p>
          <Link
            to="/"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium transition hover:bg-blue-500"
          >
            Go home
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

function PublicHeader() {
  return (
    <header className="bg-[#0f172a] border-b border-slate-800">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <span className="text-lg font-semibold tracking-tight text-white">
            Panopticon
          </span>
          <span className="text-xs text-slate-400">Corpus Pipeline</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            to="/auth/signup"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Sign up free
          </Link>
        </div>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="bg-[#0f172a] border-t border-slate-800">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-6 sm:flex-row">
        <p className="text-xs text-slate-500">
          &copy; {new Date().getFullYear()} Panopticon AI. All rights reserved.
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
  );
}

// ─── Document viewer (read-only) ────────────────────────────────────────────

function DocumentCard({
  doc,
}: {
  doc: {
    id: string;
    source_filename: string;
    status: string;
    parsed_markdown: string | null;
    user_markdown: string | null;
    chunks_json: unknown[] | null;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const markdown = doc.user_markdown ?? doc.parsed_markdown;
  const chunkCount = doc.chunks_json?.length ?? 0;

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-text">
            {doc.source_filename}
          </span>
          <span className="rounded-full bg-surface-alt px-2 py-0.5 text-xs text-text-muted">
            {doc.status}
          </span>
          {chunkCount > 0 && (
            <span className="text-xs text-text-muted">
              {chunkCount} chunk{chunkCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {markdown && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-corpus-600 hover:text-corpus-700"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
      </div>
      {expanded && markdown && (
        <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-surface-alt p-4 font-mono text-xs leading-relaxed text-text">
          {markdown}
        </pre>
      )}
    </div>
  );
}

// ─── Main view ──────────────────────────────────────────────────────────────

function PublicSessionView() {
  const { session, documents } = Route.useLoaderData();
  const [activeTab, setActiveTab] = useState<"documents" | "crosswalk">(
    session.crosswalk_markdown ? "crosswalk" : "documents",
  );

  const tabs = [
    { key: "documents" as const, label: "Documents", badge: documents.length },
    ...(session.crosswalk_markdown
      ? [{ key: "crosswalk" as const, label: "Crosswalk" }]
      : []),
  ];

  return (
    <div className="flex min-h-screen flex-col bg-surface-alt font-[Inter,system-ui,sans-serif]">
      <PublicHeader />

      {/* Session banner */}
      <div className="border-b border-border bg-white">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              Public
            </span>
            <span className="text-xs text-text-muted">
              {documents.length} document{documents.length !== 1 ? "s" : ""}
            </span>
          </div>
          <h1 className="mt-2 text-xl font-bold text-text">{session.name}</h1>
          <p className="mt-1 text-sm text-text-muted">
            Shared corpus session with AI-parsed documents
            {session.crosswalk_markdown ? " and cross-framework crosswalk" : ""}
          </p>
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {/* Tabs */}
        <div className="mb-6 flex gap-1 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "border-b-2 border-corpus-600 text-corpus-600"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {tab.label}
              {"badge" in tab && tab.badge ? (
                <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-corpus-100 text-xs text-corpus-700">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "documents" && (
          <div className="space-y-3">
            {documents.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-muted">
                No documents in this session.
              </p>
            ) : (
              documents.map((doc) => <DocumentCard key={doc.id} doc={doc} />)
            )}
          </div>
        )}

        {activeTab === "crosswalk" && session.crosswalk_markdown && (
          <div className="rounded-lg border border-border bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-text">
              Cross-Framework Crosswalk
            </h2>
            <pre className="max-h-150 overflow-auto rounded-md bg-surface-alt p-4 font-mono text-xs leading-relaxed text-text">
              {session.crosswalk_markdown}
            </pre>
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 rounded-lg border border-slate-200 bg-white p-8 text-center">
          <h2 className="mb-2 text-lg font-semibold text-text">
            Create your own corpus sessions
          </h2>
          <p className="mb-4 text-sm text-text-muted">
            Upload compliance documents, AI-parse into structured Markdown, and
            generate cross-framework crosswalks.
          </p>
          <Link
            to="/auth/signup"
            className="inline-block rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Get started free
          </Link>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
