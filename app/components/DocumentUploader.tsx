/**
 * Document upload component.
 *
 * Accepts text via paste (textarea) or file upload (.txt, .md).
 * Insert + enqueue happens in one server call. Polling picks up progress.
 */

import { useState, useRef } from "react";
import { useSessionStore } from "@/lib/stores";
import { insertDocForParse, reparseDocument } from "@/server/session-actions";

export function DocumentUploader() {
  const store = useSessionStore();
  const [sourceText, setSourceText] = useState("");
  const [fileName, setFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleParse() {
    if (!sourceText.trim() || !store.sessionId) return;
    setSubmitting(true);
    setError(null);

    try {
      // Insert document (fast — returns immediately)
      const { documentId, sortOrder } = await insertDocForParse({
        data: {
          sessionId: store.sessionId,
          sourceText,
          sourceFileName: fileName || undefined,
        },
      });

      // Show document in "parsing" state immediately
      store.addDocument({
        id: documentId,
        sessionId: store.sessionId,
        sourceFilename: fileName || "upload.txt",
        sourceHash: "",
        parsedMarkdown: null,
        parseModel: null,
        parseTokensIn: null,
        parseTokensOut: null,
        status: "parsing",
        userMarkdown: null,
        errorMessage: null,
        chunks: null,
        sortOrder,
      });

      // Switch to Documents tab so user sees the parsing card
      store.setTab("documents");

      // Reset form (user can start another upload)
      setSourceText("");
      setFileName("");

      // Fire off parse — polling picks up result when done
      reparseDocument({ data: { documentId } }).catch(() => {
        store.updateDocument(documentId, {
          status: "failed",
          errorMessage: "Parse failed — click Re-parse to retry",
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        setSourceText(text);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-4 text-sm font-semibold text-text">
          Upload a compliance document
        </h2>

        {/* File input */}
        <div className="mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-muted hover:bg-surface-alt"
          >
            Choose file (.txt, .md)
          </button>
          {fileName && (
            <span className="ml-3 text-sm text-text-muted">{fileName}</span>
          )}
        </div>

        {/* Text input */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-text-muted">
            Or paste document text
          </label>
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Paste raw compliance/regulatory text here..."
            rows={16}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
          />
        </div>

        {/* Word count */}
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {sourceText.split(/\s+/).filter(Boolean).length} words
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-md border border-error/20 bg-error/5 p-3 text-sm text-error">
            {error}
          </div>
        )}

        {/* Parse button */}
        <button
          onClick={handleParse}
          disabled={!sourceText.trim() || submitting}
          className="rounded-md bg-corpus-600 px-6 py-2 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
        >
          {submitting ? "Uploading..." : "Parse Document"}
        </button>
      </div>
    </div>
  );
}
