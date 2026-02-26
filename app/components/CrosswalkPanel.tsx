/**
 * Crosswalk generation and editing panel.
 *
 * Generate button triggers AI crosswalk across all parsed documents.
 * Shows rendered result with edit capability.
 */

import { useState, useEffect } from "react";
import { useSessionStore } from "@/lib/stores";
import {
  generateCrosswalk,
  saveCrosswalkEdit,
  markComplete,
} from "@/server/session-actions";

export function CrosswalkPanel() {
  const store = useSessionStore();
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(store.crosswalkMarkdown ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync editText when crosswalk arrives from polling
  useEffect(() => {
    if (store.crosswalkMarkdown && !editing) {
      setEditText(store.crosswalkMarkdown);
    }
  }, [store.crosswalkMarkdown, editing]);

  const readyDocs = store.documents.filter(
    (d) =>
      d.status === "parsed" ||
      d.status === "edited" ||
      d.status === "chunked" ||
      d.status === "watermarked",
  );
  const canGenerate = readyDocs.length >= 2;
  const isPending = store.sessionStatus === "crosswalk_pending";

  async function handleMarkComplete() {
    if (!store.sessionId) return;
    await markComplete({ data: { sessionId: store.sessionId } });
    store.setSessionStatus("complete");
  }

  async function handleGenerate() {
    if (!store.sessionId) return;
    setGenerating(true);
    setError(null);

    try {
      // Ensure session is marked complete first
      if (store.sessionStatus === "uploading") {
        await handleMarkComplete();
      }

      // Set status immediately so UI shows progress
      store.setSessionStatus("crosswalk_pending");
      setGenerating(false);

      // Fire off crosswalk generation — polling picks up result when done
      generateCrosswalk({
        data: { sessionId: store.sessionId },
      }).catch((err) => {
        setError(err instanceof Error ? err.message : "Crosswalk generation failed");
        store.setSessionStatus("uploading");
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crosswalk generation failed");
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!store.sessionId) return;
    setSaving(true);
    try {
      await saveCrosswalkEdit({
        data: { sessionId: store.sessionId, markdown: editText },
      });
      store.setCrosswalk(editText);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Generation controls */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-2 text-sm font-semibold text-text">
          Cross-Framework Mapping
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          Generate a crosswalk that maps equivalent concepts, overlapping
          requirements, and gaps across your uploaded compliance documents.
        </p>

        <div className="mb-4 flex items-center gap-4">
          <span className="text-xs text-text-muted">
            {readyDocs.length} document{readyDocs.length !== 1 ? "s" : ""} ready
          </span>
          {!canGenerate && (
            <span className="text-xs text-warning">
              Need at least 2 parsed documents
            </span>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-error/20 bg-error/5 p-3 text-sm text-error">
            {error}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate || generating || isPending}
          className="rounded-md bg-corpus-600 px-6 py-2 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
        >
          {generating
            ? "Submitting..."
            : isPending
              ? "Generating crosswalk..."
              : store.crosswalkMarkdown
                ? "Regenerate Crosswalk"
                : "Generate Crosswalk"}
        </button>

        {isPending && (
          <p className="mt-3 text-xs text-text-muted">
            AI is analyzing all documents and mapping cross-framework
            relationships. This may take 1-2 minutes.
          </p>
        )}
      </div>

      {/* Crosswalk result */}
      {store.crosswalkMarkdown && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">
              Crosswalk Result
            </h2>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-md bg-corpus-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(false);
                      setEditText(store.crosswalkMarkdown ?? "");
                    }}
                    className="rounded-md border border-border px-4 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-md border border-border px-4 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() =>
                  navigator.clipboard.writeText(store.crosswalkMarkdown ?? "")
                }
                className="rounded-md border border-border px-4 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
              >
                Copy
              </button>
            </div>
          </div>

          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              spellCheck={false}
              rows={30}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
            />
          ) : (
            <pre className="max-h-150 overflow-auto rounded-md bg-surface-alt p-4 font-mono text-xs leading-relaxed text-text">
              {store.crosswalkMarkdown}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
