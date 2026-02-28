/**
 * Crosswalk generation and editing panel.
 *
 * Generate button triggers AI crosswalk across all parsed documents.
 * Shows rendered result with edit capability.
 */

import { useState, useEffect } from "react";
import { useSessionStore } from "@/lib/stores";
import { computeWorkflowReadiness } from "@/lib/workflow-readiness";
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
  const [copied, setCopied] = useState(false);

  // Sync editText when crosswalk arrives from polling
  useEffect(() => {
    if (store.crosswalkMarkdown && !editing) {
      setEditText(store.crosswalkMarkdown);
    }
  }, [store.crosswalkMarkdown, editing]);

  const { gates, promotedWatermarkedDocs, blockers, canGenerateCrosswalk, quality } = computeWorkflowReadiness(store.documents);
  const canGenerate = canGenerateCrosswalk;
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
        store.setSessionStatus("complete");
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

        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-4">
            <span className="rounded-full bg-corpus-100 px-2 py-0.5 text-xs font-medium text-corpus-700">
              Quality {quality.overall}%
            </span>
            <span className="text-xs text-text-muted">
              {promotedWatermarkedDocs.length} of {store.documents.length} document{store.documents.length !== 1 ? "s" : ""} promoted + watermarked
            </span>
            {!canGenerate && (
              <span className="text-xs text-warning">
                Workflow gates not satisfied
              </span>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {gates.map((gate) => (
              <div
                key={gate.id}
                className={`rounded-md border px-2 py-1.5 text-xs ${gate.pass ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
              >
                <div className="font-medium">{gate.pass ? "✓" : "•"} {gate.label}</div>
                <div className="opacity-80">{gate.detail}</div>
              </div>
            ))}
          </div>
          {blockers.length > 0 && (
            <div className="rounded-md border border-warning/20 bg-warning/5 p-2">
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-warning">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}
          {promotedWatermarkedDocs.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {promotedWatermarkedDocs.map((d) => (
                <span
                  key={d.id}
                  className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                >
                  {d.sourceHash.slice(0, 12)} (promoted)
                </span>
              ))}
            </div>
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
            <div>
              <h2 className="text-sm font-semibold text-text">
                Crosswalk Result
              </h2>
              {store.crosswalkChunks && (
                <p className="text-xs text-emerald-600">
                  {store.crosswalkChunks.length} watermarked chunks
                </p>
              )}
            </div>
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
                onClick={() => {
                  navigator.clipboard.writeText(store.crosswalkMarkdown ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-md border border-border px-4 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
              >
                {copied ? "Copied!" : "Copy"}
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
