import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  createSession,
  getSessions,
  removeSession,
} from "@/server/session-actions";

const SITE_URL = "https://panopticonlabs.ai";

export const Route = createFileRoute("/_authed/sessions/")({
  loader: () => getSessions(),
  head: () => ({
    meta: [{ title: "Sessions — Panopticon AI" }],
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
              name: "Sessions",
            },
          ],
        }),
      },
    ],
  }),
  component: SessionListPage,
});

// ─── Pipeline workflow steps ─────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  {
    step: "1",
    title: "Upload",
    desc: "Add compliance documents to a session. Paste text or upload .txt/.md files — one document per regulatory framework.",
  },
  {
    step: "2",
    title: "AI Parse & Edit",
    desc: "AI converts raw text into structured corpus Markdown with CFPO prompt architecture. Review and edit every parse before proceeding.",
  },
  {
    step: "3",
    title: "Chunk & Watermark",
    desc: "Split documents into heading-aware chunks with token counts, then apply cryptographic provenance watermarks to each chunk.",
  },
  {
    step: "4",
    title: "Crosswalk",
    desc: "Generate a cross-framework mapping across all documents in the session. AI identifies overlapping controls between GDPR, HIPAA, SOC 2, and more.",
  },
  {
    step: "5",
    title: "Download",
    desc: "Export the complete bundle — parsed documents, watermarked chunks, crosswalk, and README — as individual files or ZIP.",
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

function SessionListPage() {
  const sessions = Route.useLoaderData();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [newName, setNewName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showNameInput) nameInputRef.current?.focus();
  }, [showNameInput]);

  async function handleCreate(name?: string) {
    setCreating(true);
    setShowNameInput(false);
    try {
      const trimmed = name?.trim();
      const result = await createSession({
        data: trimmed ? { name: trimmed } : {},
      });
      navigate({ to: "/sessions/$id", params: { id: result.sessionId } });
    } finally {
      setCreating(false);
      setNewName("");
    }
  }

  async function handleDelete(sessionId: string) {
    await removeSession({ data: { sessionId } });
    window.location.reload();
  }

  const statusColors: Record<string, string> = {
    uploading: "bg-corpus-100 text-corpus-700",
    complete: "bg-green-100 text-green-700",
    crosswalk_pending: "bg-yellow-100 text-yellow-700",
    crosswalk_done: "bg-green-100 text-green-700",
    archived: "bg-gray-100 text-gray-500",
  };

  const statusLabels: Record<string, string> = {
    uploading: "in progress",
    complete: "complete",
    crosswalk_pending: "crosswalk pending",
    crosswalk_done: "crosswalk done",
    archived: "archived",
  };

  return (
    <div>
      {/* Workflow guide */}
      <div className="mb-8 rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-1 text-sm font-semibold text-text">
          How the pipeline works
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          Each session walks your documents through a five-step compliance
          pipeline. Human review at every stage.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          {WORKFLOW_STEPS.map((item, i) => (
            <div key={item.step} className="flex gap-3 sm:flex-col sm:gap-2">
              <div className="flex items-start gap-2 sm:items-center">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-corpus-600 text-xs font-bold text-white">
                  {item.step}
                </span>
                {i < WORKFLOW_STEPS.length - 1 && (
                  <span className="mt-0.5 hidden text-text-muted/40 sm:inline">
                    &rarr;
                  </span>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-text">{item.title}</p>
                <p className="text-xs leading-relaxed text-text-muted">
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Session list header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Sessions</h1>
          <p className="text-xs text-text-muted">
            Each session groups related compliance documents for parsing,
            crosswalk, and export.
          </p>
        </div>
        {showNameInput ? (
          <div className="flex items-center gap-2">
            <input
              ref={nameInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate(newName);
                if (e.key === "Escape") {
                  setShowNameInput(false);
                  setNewName("");
                }
              }}
              placeholder="Session name..."
              className="rounded-md border border-border bg-white px-3 py-2 text-sm text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
            />
            <button
              onClick={() => handleCreate(newName)}
              disabled={creating}
              className="rounded-md bg-corpus-600 px-4 py-2 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => {
                setShowNameInput(false);
                setNewName("");
              }}
              className="text-sm text-text-muted hover:text-text"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNameInput(true)}
            disabled={creating}
            className="rounded-md bg-corpus-600 px-4 py-2 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
          >
            New Session
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-12 text-center">
          <p className="mb-1 text-sm font-medium text-text">
            No sessions yet
          </p>
          <p className="text-xs text-text-muted">
            Create a session to start parsing compliance documents through the
            pipeline.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-surface p-4 transition hover:border-corpus-500"
              onClick={() =>
                navigate({
                  to: "/sessions/$id",
                  params: { id: session.id },
                })
              }
            >
              <div>
                <p className="text-sm font-medium text-text">{session.name}</p>
                <p className="text-xs text-text-muted">
                  Created{" "}
                  {new Date(session.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {session.is_public && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Public
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[session.status] ?? "bg-gray-100 text-gray-500"}`}
                >
                  {statusLabels[session.status] ?? session.status.replace(/_/g, " ")}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(session.id);
                  }}
                  className="text-xs text-text-muted hover:text-error"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
