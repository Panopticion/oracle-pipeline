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
import {
  getSessionWithDocuments,
  renameSession,
  toggleSessionPublic,
} from "@/server/session-actions";
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
    <div className="mb-6 flex items-center gap-1 text-xs">
      {PIPELINE_STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          {i > 0 && <span className="mx-0.5 text-text-muted/40">&rarr;</span>}
          <span
            className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
              i < currentStep
                ? "bg-green-100 text-green-700"
                : i === currentStep
                  ? "bg-corpus-100 text-corpus-700"
                  : "bg-surface-alt text-text-muted/50"
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
  upload: "Add compliance documents to your session. Paste text or upload .txt/.md files.",
  documents: "Review AI-parsed output, edit if needed, then chunk and watermark each document.",
  crosswalk: "Generate a cross-framework mapping across all your parsed documents.",
  download: "Download the complete bundle with full documents, watermarked chunks, and crosswalk.",
};

// ─── Editable session name ───────────────────────────────────────────────────

function EditableSessionName({
  sessionId,
  name,
  onRename,
}: {
  sessionId: string;
  name: string;
  onRename: (name: string) => void;
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
    await renameSession({ data: { sessionId, name: trimmed } });
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
    <button
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
}: {
  sessionId: string;
  isPublic: boolean;
  onToggle: (isPublic: boolean) => void;
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
      await toggleSessionPublic({ data: { sessionId, isPublic: next } });
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
      <button
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
        <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-lg border border-border bg-white p-4 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-text">Share session</span>
            <button
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
            <button
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
                <button
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
        data: { sessionId: session.id },
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
        />
      </div>

      {/* Pipeline progress */}
      <PipelineSteps currentStep={currentStep} />

      {/* Tabs */}
      <div className="mb-2 flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleSetTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              currentTab === tab.key
                ? "border-b-2 border-corpus-600 text-corpus-600"
                : "text-text-muted hover:text-text"
            }`}
          >
            {tab.label}
            {tab.badge ? (
              <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-corpus-100 text-xs text-corpus-700">
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab helper text */}
      <p className="mb-6 text-xs text-text-muted">{TAB_HELP[currentTab]}</p>

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
