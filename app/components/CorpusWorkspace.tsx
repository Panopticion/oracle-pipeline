/**
 * Main workspace component for a corpus parse session.
 *
 * Tab-based layout: Upload | Documents | Crosswalk | Download
 * Hydrates Zustand store from server-loaded data on mount.
 * Resets store on unmount to prevent stale state across sessions.
 * Polls for "parsing" documents so progress is shown even after navigation.
 */

import { useEffect, useMemo, useCallback, useState, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useSessionStore, type SessionDoc, type WorkspaceTab } from "@/lib/stores";
import { computeWorkflowReadiness } from "@/lib/workflow-readiness";
import { useSessionShellOps } from "@/lib/use-session-shell-ops";
import { DocumentUploader } from "./DocumentUploader";
import { DocumentEditor } from "./DocumentEditor";
import { CrosswalkPanel } from "./CrosswalkPanel";
import { DownloadBundle } from "./DownloadBundle";

interface Props {
  session: {
    id: string;
    name: string;
    status: string;
    is_public: boolean;
    crosswalk_markdown: string | null;
    crosswalk_chunks_json: Array<{
      sequence: number;
      section_title: string;
      heading_level: number;
      content: string;
      content_hash: string;
      token_count: number;
      heading_path: string[];
    }> | null;
  };
  documents: Array<{
    id: string;
    session_id: string;
    source_filename: string;
    source_hash: string;
    parsed_markdown: string | null;
    parse_model: string | null;
    parse_tokens_in: number | null;
    parse_tokens_out: number | null;
    status: string;
    user_markdown: string | null;
    error_message: string | null;
    audit_warning_count?: number | null;
    audit_warning_preview?: string[] | null;
    parse_job?: {
      id: number;
      status: "pending" | "in_progress" | "done" | "failed";
      retry_count: number;
      max_retries: number;
      updated_at: string;
      error: string | null;
      step?: string | null;
      message?: string | null;
    } | null;
    chunks_json: Array<{
      sequence: number;
      section_title: string;
      heading_level: number;
      content: string;
      content_hash: string;
      token_count: number;
      heading_path: string[];
    }> | null;
    sort_order: number;
    promoted_at: string | null;
  }>;
}

// ─── Doc mapper (server props → client format) ─────────────────────────────

function mapChunksJson(
  chunks: Props["session"]["crosswalk_chunks_json"],
): import("@/lib/stores").ChunkData[] | null {
  if (!chunks) return null;
  return chunks.map((c) => ({
    sequence: c.sequence,
    sectionTitle: c.section_title,
    headingLevel: c.heading_level,
    content: c.content,
    contentHash: c.content_hash,
    tokenCount: c.token_count,
    headingPath: c.heading_path,
  }));
}

function mapServerDocs(documents: Props["documents"]): SessionDoc[] {
  return documents.map((d) => ({
    id: d.id,
    sessionId: d.session_id,
    sourceFilename: d.source_filename,
    sourceHash: d.source_hash,
    parsedMarkdown: d.parsed_markdown,
    parseModel: d.parse_model,
    parseTokensIn: d.parse_tokens_in,
    parseTokensOut: d.parse_tokens_out,
    status: d.status as SessionDoc["status"],
    userMarkdown: d.user_markdown,
    errorMessage: d.error_message,
    auditWarningCount: d.audit_warning_count ?? 0,
    auditWarningPreview: d.audit_warning_preview ?? [],
    parseJob: d.parse_job
      ? {
          id: d.parse_job.id,
          status: d.parse_job.status,
          retryCount: d.parse_job.retry_count,
          maxRetries: d.parse_job.max_retries,
          updatedAt: d.parse_job.updated_at,
          error: d.parse_job.error,
          step: d.parse_job.step ?? null,
          message: d.parse_job.message ?? null,
        }
      : null,
    chunks: d.chunks_json
      ? d.chunks_json.map((c) => ({
          sequence: c.sequence,
          sectionTitle: c.section_title,
          headingLevel: c.heading_level,
          content: c.content,
          contentHash: c.content_hash,
          tokenCount: c.token_count,
          headingPath: c.heading_path,
        }))
      : null,
    sortOrder: d.sort_order,
    promotedAt: d.promoted_at,
  }));
}

// ─── Pipeline step indicator ────────────────────────────────────────────────

const PIPELINE_STEPS = [
  "Upload",
  "Parse & Edit",
  "Chunk",
  "Watermark",
  "Crosswalk",
  "Download",
] as const;

function getCurrentStep(docs: SessionDoc[], crosswalkMd: string | null): number {
  if (docs.length === 0) return 0;
  const hasChunked = docs.some((d) => d.status === "chunked");
  const hasWatermarked = docs.some((d) => d.status === "watermarked");
  const allWatermarked = docs.length > 0 && docs.every((d) => d.status === "watermarked");
  if (crosswalkMd) return 5;
  if (allWatermarked) return 4;
  if (hasWatermarked) return 3;
  if (hasChunked) return 2;
  return 1;
}

function PipelineSteps({ currentStep }: { currentStep: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-1.5 text-xs">
      {PIPELINE_STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-1.5">
          {i > 0 && <span className="mx-0.5 text-text-muted/40">→</span>}
          <span
            className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
              i < currentStep
                ? "bg-corpus-50 text-corpus-700"
                : i === currentStep
                  ? "bg-corpus-600 text-white"
                  : "bg-surface-alt text-text-muted"
            }`}
          >
            {step}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Tab helper text ────────────────────────────────────────────────────────

const TAB_HELP: Record<WorkspaceTab, string> = {
  upload:
    "Add compliance documents to your session. Paste text or upload .txt/.md/.json/.yaml/.pdf/.docx files.",
  documents: "Review AI-parsed output, edit if needed, then chunk and watermark each document.",
  crosswalk: "Generate a cross-framework mapping across all your parsed documents.",
  download: "Download the complete bundle with full documents, watermarked chunks, and crosswalk.",
};

// ─── Editable session name ───────────────────────────────────────────────────

function EditableSessionName({
  sessionId,
  name,
  onRename,
  onPersistRename,
}: {
  sessionId: string;
  name: string;
  onRename: (name: string) => void;
  onPersistRename: (input: { sessionId: string; name: string }) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function save() {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === name) {
      setDraft(name);
      return;
    }
    onRename(trimmed);
    await onPersistRename({ sessionId, name: trimmed });
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        className="rounded border border-corpus-300 bg-white px-2 py-0.5 text-lg font-semibold text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
      />
    );
  }

  return (
    <button type="button"
      onClick={() => setEditing(true)}
      className="group flex items-center gap-1.5 text-lg font-semibold text-text hover:text-corpus-600"
      title="Click to rename"
    >
      {name}
      <span className="text-xs text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
        edit
      </span>
    </button>
  );
}

// ─── Share panel ─────────────────────────────────────────────────────────────

function SharePanel({
  sessionId,
  isPublic,
  onToggle,
  onPersistToggle,
}: {
  sessionId: string;
  isPublic: boolean;
  onToggle: (isPublic: boolean) => void;
  onPersistToggle: (input: { sessionId: string; isPublic: boolean }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = `https://panopticonlabs.ai/share/${sessionId}`;

  async function handleToggle() {
    setToggling(true);
    const next = !isPublic;
    onToggle(next);
    try {
      await onPersistToggle({ sessionId, isPublic: next });
    } catch {
      onToggle(!next); // revert on error
    } finally {
      setToggling(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative">
      <button type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
          isPublic
            ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
            : "border-border bg-white text-text-muted hover:bg-surface-alt"
        }`}
      >
        {isPublic ? "Public" : "Private"}
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-text">Share session</span>
            <button type="button"
              onClick={() => setOpen(false)}
              className="text-text-muted hover:text-text"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-text">Make public</p>
              <p className="text-xs text-text-muted">
                Anyone with the link can view
              </p>
            </div>
            <button type="button"
              onClick={handleToggle}
              disabled={toggling}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                isPublic ? "bg-green-500" : "bg-gray-300"
              } ${toggling ? "opacity-50" : ""}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  isPublic ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>

          {isPublic && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-text-muted">
                Share link
              </p>
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface-alt p-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 bg-transparent text-xs text-text outline-none"
                />
                <button type="button"
                  onClick={handleCopy}
                  className="shrink-0 rounded bg-corpus-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-corpus-700"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function CorpusWorkspace({ session, documents }: Props) {
  const store = useSessionStore();
  const {
    getSessionWithDocuments,
    recordSessionQualitySnapshot,
    renameSession,
    toggleSessionPublic,
  } = useSessionShellOps();

  // Map server props to client format (memoized)
  const serverDocs = useMemo(() => mapServerDocs(documents), [documents]);

  // Store is ready once hydrated with THIS session's data.
  // Before hydration (SSR + initial client render), render from props.
  const storeReady = store.sessionId === session.id;

  const sessionName = storeReady ? store.sessionName : session.name;
  const sessionStatus = storeReady ? store.sessionStatus : session.status;
  const isPublic = storeReady ? store.isPublic : session.is_public;
  const docs = storeReady ? store.documents : serverDocs;
  const crosswalkMd = storeReady ? store.crosswalkMarkdown : session.crosswalk_markdown;
  const currentTab = storeReady
    ? store.currentTab
    : serverDocs.length === 0
      ? "upload"
      : session.status === "crosswalk_done"
        ? "crosswalk"
        : "documents";

  // Hydrate store on mount. No reset on unmount — preserves tab position
  // if user navigates back to the same session. hydrate() overwrites
  // everything when entering a different session.
  useEffect(() => {
    store.hydrate({
      id: session.id,
      name: session.name,
      status: session.status as Parameters<typeof store.hydrate>[0]["status"],
      isPublic: session.is_public,
      crosswalkMarkdown: session.crosswalk_markdown,
      crosswalkChunks: mapChunksJson(session.crosswalk_chunks_json),
      documents: mapServerDocs(documents),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Poll while any document is in a processing state (parsing, parsed, chunked)
  // or session has a pending crosswalk, so UI picks up worker progress.
  const hasProcessing =
    docs.some(
      (d) => d.status === "parsing" || d.status === "parsed" || d.status === "chunked",
    ) || store.sessionStatus === "crosswalk_pending";

  const refreshFromServer = useCallback(async () => {
    try {
      const fresh = await getSessionWithDocuments({
        sessionId: session.id,
      });
      store.hydrate({
        id: fresh.session.id,
        name: fresh.session.name,
        status: fresh.session.status as Parameters<typeof store.hydrate>[0]["status"],
        isPublic: fresh.session.is_public,
        crosswalkMarkdown: fresh.session.crosswalk_markdown,
        crosswalkChunks: mapChunksJson(fresh.session.crosswalk_chunks_json),
        documents: mapServerDocs(fresh.documents),
      });
    } catch {
      // Silently ignore — polling is best-effort
    }
  }, [session.id, store]);

  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(refreshFromServer, 3000);
    return () => clearInterval(interval);
  }, [hasProcessing, refreshFromServer]);

  const handleSetTab = (tab: WorkspaceTab) => {
    if (storeReady) {
      store.setTab(tab);
      // Refresh from server on crosswalk/download tabs to ensure docs are current
      if (tab === "crosswalk" || tab === "download") {
        refreshFromServer();
      }
    }
  };

  const currentStep = getCurrentStep(docs, crosswalkMd);
  const readiness = computeWorkflowReadiness(docs);
  const lastSnapshotKeyRef = useRef<string>("");

  const snapshotPayload = useMemo(
    () => ({
      quality: readiness.quality,
      gatePass: {
        parse: readiness.gates.find((gate) => gate.id === "parse")?.pass ?? false,
        chunk: readiness.gates.find((gate) => gate.id === "chunk")?.pass ?? false,
        watermark: readiness.gates.find((gate) => gate.id === "watermark")?.pass ?? false,
        promote: readiness.gates.find((gate) => gate.id === "promote")?.pass ?? false,
      },
      counts: {
        totalDocs: readiness.totalDocs,
        promotedWatermarkedDocs: readiness.promotedWatermarkedDocs.length,
      },
      canGenerateCrosswalk: readiness.canGenerateCrosswalk,
      sessionStatus: sessionStatus as "uploading" | "complete" | "crosswalk_pending" | "crosswalk_done" | "archived",
      crosswalkPresent: Boolean(crosswalkMd),
    }),
    [
      readiness.quality,
      readiness.gates,
      readiness.totalDocs,
      readiness.promotedWatermarkedDocs.length,
      readiness.canGenerateCrosswalk,
      sessionStatus,
      crosswalkMd,
    ],
  );

  useEffect(() => {
    if (!storeReady) return;

    const snapshotKey = JSON.stringify(snapshotPayload);
    if (snapshotKey === lastSnapshotKeyRef.current) return;
    lastSnapshotKeyRef.current = snapshotKey;

    void recordSessionQualitySnapshot({
      sessionId: session.id,
      metrics: snapshotPayload,
    }).catch(() => {
      // Best-effort: metrics persistence should never block UI interactions.
    });
  }, [session.id, snapshotPayload, storeReady]);

  const notParseReadyDocs = docs.filter(
    (d) =>
      !(
        d.status === "parsed" ||
        d.status === "edited" ||
        d.status === "chunked" ||
        d.status === "watermarked"
      ),
  );
  const notChunkedDocs = docs.filter(
    (d) => !(d.status === "chunked" || d.status === "watermarked"),
  );
  const notWatermarkedDocs = docs.filter((d) => d.status !== "watermarked");
  const notPromotedDocs = docs.filter(
    (d) => d.status === "watermarked" && !d.promotedAt,
  );

  function openDocumentsFor(docId: string | null) {
    if (!storeReady) return;
    store.setTab("documents");
    if (docId) {
      store.setActiveDocument(docId);
    }
  }

  const tabs: { key: WorkspaceTab; label: string; badge?: number }[] = [
    { key: "upload", label: "Upload" },
    {
      key: "documents",
      label: "Documents",
      badge: docs.length || undefined,
    },
    { key: "crosswalk", label: "Crosswalk" },
    { key: "download", label: "Download" },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-start gap-3">
          <Link
            to="/sessions"
            className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-alt hover:text-text"
            title="Back to sessions"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <EditableSessionName
              sessionId={session.id}
              name={sessionName}
              onRename={(n) => {
                if (storeReady) store.setSessionName(n);
              }}
              onPersistRename={renameSession}
            />
            <p className="text-xs text-text-muted">
              {sessionStatus === "uploading" ? "in progress" : sessionStatus.replace(/_/g, " ")} &middot; {docs.length} document
              {docs.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <SharePanel
          sessionId={session.id}
          isPublic={isPublic}
          onToggle={(v) => {
            if (storeReady) store.setIsPublic(v);
          }}
          onPersistToggle={toggleSessionPublic}
        />
      </div>

      {/* Pipeline progress */}
      <PipelineSteps currentStep={currentStep} />

      {/* Workflow readiness */}
      <div className="mb-4 rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-text">Workflow Readiness</p>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-corpus-100 px-2 py-0.5 text-[11px] font-medium text-corpus-700">
              Quality {readiness.quality.overall}%
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${readiness.canGenerateCrosswalk ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
            >
              {readiness.canGenerateCrosswalk ? "Crosswalk ready" : "Not ready"}
            </span>
          </div>
        </div>
        <div className="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-border/60 bg-surface-alt px-2 py-1 text-xs text-text-muted">
            Parse accuracy: <span className="font-semibold text-text">{readiness.quality.parseAccuracy}%</span>
          </div>
          <div className="rounded-md border border-border/60 bg-surface-alt px-2 py-1 text-xs text-text-muted">
            Chunk coverage: <span className="font-semibold text-text">{readiness.quality.chunkCoverage}%</span>
          </div>
          <div className="rounded-md border border-border/60 bg-surface-alt px-2 py-1 text-xs text-text-muted">
            Watermark integrity: <span className="font-semibold text-text">{readiness.quality.watermarkIntegrity}%</span>
          </div>
          <div className="rounded-md border border-border/60 bg-surface-alt px-2 py-1 text-xs text-text-muted">
            Promotion readiness: <span className="font-semibold text-text">{readiness.quality.promotionReadiness}%</span>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {readiness.gates.map((gate) => (
            <div
              key={gate.id}
              className={`rounded-md border px-2 py-1.5 text-xs ${gate.pass ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
            >
              <div className="font-medium">{gate.pass ? "✓" : "•"} {gate.label}</div>
              <div className="opacity-80">{gate.detail}</div>
            </div>
          ))}
        </div>
        {readiness.blockers.length > 0 && (
          <div className="mt-2 rounded-md border border-warning/20 bg-warning/5 p-2">
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-warning">
              {readiness.blockers.slice(0, 3).map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              {notParseReadyDocs.length > 0 && (
                <button type="button"
                  onClick={() => openDocumentsFor(notParseReadyDocs[0]?.id ?? null)}
                  className="rounded-md border border-warning/30 bg-white px-2 py-1 text-xs text-warning hover:bg-warning/10"
                >
                  Resolve parse blockers ({notParseReadyDocs.length})
                </button>
              )}
              {notChunkedDocs.length > 0 && (
                <button type="button"
                  onClick={() => openDocumentsFor(notChunkedDocs[0]?.id ?? null)}
                  className="rounded-md border border-warning/30 bg-white px-2 py-1 text-xs text-warning hover:bg-warning/10"
                >
                  Resolve chunk blockers ({notChunkedDocs.length})
                </button>
              )}
              {notWatermarkedDocs.length > 0 && (
                <button type="button"
                  onClick={() => openDocumentsFor(notWatermarkedDocs[0]?.id ?? null)}
                  className="rounded-md border border-warning/30 bg-white px-2 py-1 text-xs text-warning hover:bg-warning/10"
                >
                  Resolve watermark blockers ({notWatermarkedDocs.length})
                </button>
              )}
              {notPromotedDocs.length > 0 && (
                <button type="button"
                  onClick={() => openDocumentsFor(notPromotedDocs[0]?.id ?? null)}
                  className="rounded-md border border-warning/30 bg-white px-2 py-1 text-xs text-warning hover:bg-warning/10"
                >
                  Resolve promotion blockers ({notPromotedDocs.length})
                </button>
              )}
              {readiness.canGenerateCrosswalk && (
                <button type="button"
                  onClick={() => handleSetTab("crosswalk")}
                  className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                >
                  Go to Crosswalk
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-2 rounded-lg border border-border bg-surface p-1">
        {tabs.map((tab) => (
          <button type="button"
            key={tab.key}
            onClick={() => handleSetTab(tab.key)}
            className={`inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-corpus-500/40 ${
              currentTab === tab.key
                ? "bg-corpus-100 text-corpus-700"
                : "text-text-muted hover:bg-surface-alt hover:text-text"
            }`}
            aria-current={currentTab === tab.key ? "page" : undefined}
          >
            {tab.label}
            {tab.badge ? (
              <span
                className={`ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs ${
                  currentTab === tab.key
                    ? "bg-corpus-200 text-corpus-800"
                    : "bg-surface-alt text-text-muted"
                }`}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab helper text */}
      <p className="mb-6 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-muted">
        {TAB_HELP[currentTab]}
      </p>

      <div className="mb-6 rounded-md border border-border bg-surface p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          First success checklist
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button"
            onClick={() => handleSetTab("upload")}
            className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-3 py-2 text-xs text-text-muted hover:bg-surface"
          >
            <span>1. Upload a document</span>
            <span className={docs.length > 0 ? "text-emerald-700" : "text-text-muted"}>{docs.length > 0 ? "✓" : "•"}</span>
          </button>
          <button type="button"
            onClick={() => handleSetTab("documents")}
            className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-3 py-2 text-xs text-text-muted hover:bg-surface"
          >
            <span>2. Chunk + watermark</span>
            <span className={docs.some((d) => d.status === "watermarked") ? "text-emerald-700" : "text-text-muted"}>
              {docs.some((d) => d.status === "watermarked") ? "✓" : "•"}
            </span>
          </button>
          <button type="button"
            onClick={() => handleSetTab("crosswalk")}
            className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-3 py-2 text-xs text-text-muted hover:bg-surface"
          >
            <span>3. Generate crosswalk</span>
            <span className={crosswalkMd ? "text-emerald-700" : "text-text-muted"}>{crosswalkMd ? "✓" : "•"}</span>
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div>
        {currentTab === "upload" && <DocumentUploader />}
        {currentTab === "documents" && <DocumentEditor />}
        {currentTab === "crosswalk" && <CrosswalkPanel />}
        {currentTab === "download" && <DownloadBundle />}
      </div>
    </div>
  );
}
