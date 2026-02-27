/**
 * Encyclopedia — persistent document library page.
 *
 * Displays all promoted documents. Users can select entries for
 * crosswalk generation, view details, or remove entries.
 */

import { useState, useEffect } from "react";
import type { EncyclopediaEntry } from "@pipeline/types";
import {
  useEncyclopediaStore,
  type EncyclopediaDoc,
} from "@/lib/encyclopedia-store";
import {
  removeEncyclopediaEntry,
  generateEncyclopediaCrosswalk,
} from "@/server/session-actions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapEntry(e: EncyclopediaEntry): EncyclopediaDoc {
  return {
    id: e.id,
    corpusId: e.corpus_id,
    title: e.title,
    tier: e.tier,
    frameworks: e.frameworks,
    industries: e.industries,
    segments: e.segments,
    sourceFilename: e.source_filename,
    markdown: e.markdown,
    chunks: e.chunks_json
      ? e.chunks_json.map((c) => ({
          sequence: c.sequence,
          sectionTitle: c.section_title,
          headingLevel: c.heading_level,
          content: c.content,
          contentHash: c.content_hash,
          tokenCount: c.token_count,
          headingPath: c.heading_path,
        }))
      : null,
    sourceSessionId: e.source_session_id,
    sourceDocumentId: e.source_document_id,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

const tierColors: Record<string, string> = {
  tier_1: "bg-red-100 text-red-700",
  tier_2: "bg-amber-100 text-amber-700",
  tier_3: "bg-blue-100 text-blue-700",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export function EncyclopediaPage({
  serverEntries,
}: {
  serverEntries: EncyclopediaEntry[];
}) {
  const store = useEncyclopediaStore();
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crosswalkError, setCrosswalkError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCrosswalk, setEditingCrosswalk] = useState(false);
  const [crosswalkEdit, setCrosswalkEdit] = useState("");

  // Hydrate store from server data on mount
  useEffect(() => {
    store.hydrate(serverEntries.map(mapEntry));
  }, [serverEntries]);

  const selectedCount = store.selectedIds.size;
  const canCrosswalk = selectedCount >= 2;

  async function handleRemove(id: string) {
    setRemoving(id);
    setError(null);
    try {
      await removeEncyclopediaEntry({ data: { entryId: id } });
      store.removeEntry(id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove entry",
      );
    } finally {
      setRemoving(null);
    }
  }

  async function handleCrosswalk() {
    setCrosswalkError(null);
    store.setCrosswalkGenerating(true);

    try {
      const result = await generateEncyclopediaCrosswalk({
        data: { entryIds: Array.from(store.selectedIds) },
      });
      store.setCrosswalk(result.crosswalkMarkdown);
      setCrosswalkEdit(result.crosswalkMarkdown);
    } catch (err) {
      setCrosswalkError(
        err instanceof Error ? err.message : "Crosswalk generation failed",
      );
    } finally {
      store.setCrosswalkGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-text">Encyclopedia</h1>
        <p className="text-xs text-text-muted">
          Your persistent library of fully processed compliance documents.
          Select two or more entries to generate a cross-framework crosswalk.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-error/20 bg-error/5 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Empty state */}
      {store.entries.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-12 text-center">
          <p className="mb-1 text-sm font-medium text-text">
            No documents in your Encyclopedia yet
          </p>
          <p className="text-xs text-text-muted">
            Process documents in a session (parse, chunk, watermark), then use
            "Save to Encyclopedia" to add them here permanently.
          </p>
        </div>
      )}

      {/* Crosswalk controls */}
      {store.entries.length >= 2 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">
                Cross-Framework Crosswalk
              </p>
              <p className="text-xs text-text-muted">
                {selectedCount} of {store.entries.length} selected
                {!canCrosswalk && " — select at least 2"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedCount > 0 && (
                <button
                  onClick={() => store.clearSelection()}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
                >
                  Clear
                </button>
              )}
              <button
                onClick={handleCrosswalk}
                disabled={!canCrosswalk || store.crosswalkGenerating}
                className="rounded-md bg-corpus-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
              >
                {store.crosswalkGenerating
                  ? "Generating..."
                  : store.crosswalkMarkdown
                    ? "Regenerate Crosswalk"
                    : "Generate Crosswalk"}
              </button>
            </div>
          </div>
          {crosswalkError && (
            <p className="mt-2 text-xs text-error">{crosswalkError}</p>
          )}
        </div>
      )}

      {/* Entry grid */}
      {store.entries.length > 0 && (
        <div className="space-y-3">
          {store.entries.map((entry) => {
            const isSelected = store.selectedIds.has(entry.id);
            const isExpanded = expandedId === entry.id;

            return (
              <div
                key={entry.id}
                className={`rounded-lg border bg-surface transition-colors ${
                  isSelected
                    ? "border-corpus-500 ring-1 ring-corpus-500/30"
                    : "border-border"
                }`}
              >
                {/* Card header */}
                <div className="flex items-center gap-3 p-4">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => store.toggleSelected(entry.id)}
                    className="h-4 w-4 rounded border-gray-300 text-corpus-600 focus:ring-corpus-500"
                  />

                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : entry.id)
                    }
                  >
                    <p className="text-sm font-medium text-text">
                      {entry.title}
                    </p>
                    <p className="text-xs text-text-muted">{entry.corpusId}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {entry.chunks && (
                      <span className="text-xs text-text-muted">
                        {entry.chunks.length} chunks
                      </span>
                    )}
                    {entry.frameworks.length > 0 && (
                      <div className="flex gap-1">
                        {entry.frameworks.slice(0, 3).map((fw) => (
                          <span
                            key={fw}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                          >
                            {fw}
                          </span>
                        ))}
                        {entry.frameworks.length > 3 && (
                          <span className="text-[10px] text-text-muted">
                            +{entry.frameworks.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        tierColors[entry.tier] ?? "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {entry.tier.replace("_", " ")}
                    </span>
                    <button
                      onClick={() => handleRemove(entry.id)}
                      disabled={removing === entry.id}
                      className="text-xs text-text-muted hover:text-error disabled:opacity-50"
                    >
                      {removing === entry.id ? "Removing..." : "Remove"}
                    </button>
                    <span
                      className="cursor-pointer text-text-muted"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : entry.id)
                      }
                    >
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border p-4">
                    <div className="mb-3 flex flex-wrap gap-4 text-xs text-text-muted">
                      <span>File: {entry.sourceFilename}</span>
                      <span>
                        Added:{" "}
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </span>
                      {entry.industries.length > 0 && (
                        <span>
                          Industries: {entry.industries.join(", ")}
                        </span>
                      )}
                      {entry.segments.length > 0 && (
                        <span>Segments: {entry.segments.join(", ")}</span>
                      )}
                    </div>
                    <pre className="max-h-96 overflow-auto rounded-md bg-surface-alt p-3 font-mono text-xs leading-relaxed text-text">
                      {entry.markdown}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Crosswalk result */}
      {store.crosswalkMarkdown && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">
              Crosswalk Result
            </h2>
            <div className="flex gap-2">
              {editingCrosswalk ? (
                <>
                  <button
                    onClick={() => {
                      store.setCrosswalk(crosswalkEdit);
                      setEditingCrosswalk(false);
                    }}
                    className="rounded-md bg-corpus-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-corpus-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingCrosswalk(false);
                      setCrosswalkEdit(store.crosswalkMarkdown ?? "");
                    }}
                    className="rounded-md border border-border px-4 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setCrosswalkEdit(store.crosswalkMarkdown ?? "");
                    setEditingCrosswalk(true);
                  }}
                  className="rounded-md border border-border px-4 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() =>
                  navigator.clipboard.writeText(
                    store.crosswalkMarkdown ?? "",
                  )
                }
                className="rounded-md border border-border px-4 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
              >
                Copy
              </button>
            </div>
          </div>

          {editingCrosswalk ? (
            <textarea
              value={crosswalkEdit}
              onChange={(e) => setCrosswalkEdit(e.target.value)}
              spellCheck={false}
              rows={30}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
            />
          ) : (
            <pre className="max-h-[600px] overflow-auto rounded-md bg-surface-alt p-4 font-mono text-xs leading-relaxed text-text">
              {store.crosswalkMarkdown}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
