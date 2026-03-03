/**
 * Document upload component.
 *
 * Accepts text via paste (textarea) or file upload
 * (.txt, .md, .markdown, .json, .yaml, .yml, .pdf, .docx).
 * Insert + enqueue happens in one server call. Polling picks up progress.
 */

import { useState, useRef } from "react";
import { useSessionStore } from "@/lib/stores";
import { useSessionWorkflowOps } from "@/lib/use-session-workflow-ops";

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "yaml", "yml"]);
const EXTRACT_EXTENSIONS = new Set(["pdf", "docx"]);

const SAMPLE_DOCUMENT_TEXT = `---
title: Sample Compliance Control Policy
frameworks: [SOC2, ISO27001]
tier: tier_1
jurisdictions: [US]
domain: access-control
---

## Access Provisioning

All user access is approved by a system owner and reviewed quarterly.

## Authentication Controls

Multi-factor authentication is required for privileged accounts.

## Logging and Monitoring

Administrative actions are logged and retained for at least 12 months.
`;

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const marker = ",";
      const idx = value.indexOf(marker);
      resolve(idx >= 0 ? value.slice(idx + marker.length) : value);
    };
    reader.readAsDataURL(file);
  });
}

function buildDefaultUploadName(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `upload-${y}${m}${day}-${hh}${mm}${ss}.txt`;
}

export function DocumentUploader() {
  const store = useSessionStore();
  const { extractUploadText, extractUrlText, insertDocForParse, reparseDocument } = useSessionWorkflowOps();
  const [sourceText, setSourceText] = useState("");
  const [fileName, setFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [isPublishedStandard, setIsPublishedStandard] = useState(true);
  const [isFirecrawlPrepped, setIsFirecrawlPrepped] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleParse() {
    if (!sourceText.trim() || !store.sessionId) return;
    setSubmitting(true);
    setError(null);
    setLastOutcome(null);

    try {
      const resolvedSourceFileName = fileName.trim() || buildDefaultUploadName();

      // Insert document (fast — returns immediately)
      const { documentId, sortOrder, isDuplicate } = await insertDocForParse({
        sessionId: store.sessionId,
        sourceText,
        sourceFileName: resolvedSourceFileName,
      });

      if (!isDuplicate) {
        // Show document in "parsing" state immediately
        store.addDocument({
          id: documentId,
          sessionId: store.sessionId,
          sourceFilename: resolvedSourceFileName,
          sourceHash: "",
          parsedMarkdown: null,
          parseModel: null,
          parseTokensIn: null,
          parseTokensOut: null,
          status: "parsing",
          userMarkdown: null,
          errorMessage: null,
          auditWarningCount: 0,
          auditWarningPreview: [],
          parseJob: null,
          chunks: null,
          sortOrder,
          promotedAt: null,
        });
      }

      // Switch to Documents tab so user sees the parsing card
      store.setTab("documents");
      store.setActiveDocument(documentId);

      // Reset form (user can start another upload)
      setSourceText("");
      setFileName("");
      setIsFirecrawlPrepped(false);
      setSourceUrl("");

      if (!isDuplicate) {
        // Fire off parse — polling picks up result when done
        const profile = isFirecrawlPrepped
          ? "firecrawl_prepped" as const
          : isPublishedStandard
            ? "published_standard" as const
            : "interpretation" as const;
        reparseDocument({
          documentId,
          parsePromptProfile: profile,
        }).then((result) => {
          store.updateDocument(documentId, {
            parseJob: {
              id: result.jobId as number,
              status: "pending",
              retryCount: 0,
              maxRetries: 3,
              updatedAt: new Date().toISOString(),
              error: null,
              step: "queued",
              message: "Queued for worker",
            },
          });
        }).catch(() => {
          store.updateDocument(documentId, {
            status: "failed",
            errorMessage: "Parse failed — click Re-parse to retry",
          });
        });
        setLastOutcome("Document queued for parse. Next: review output in Documents.");
      } else {
        setError("This file is already in this session. Opened the existing document.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setFileName(file.name);
    const ext = getExtension(file.name);

    if (TEXT_EXTENSIONS.has(ext)) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result;
        if (typeof text === "string") {
          setSourceText(text);
        }
      };
      reader.readAsText(file);
      return;
    }

    if (EXTRACT_EXTENSIONS.has(ext)) {
      setExtracting(true);
      void (async () => {
        try {
          const fileBase64 = await fileToBase64(file);
          const { text } = await extractUploadText({
            fileName: file.name,
            fileBase64,
          });
          setSourceText(text);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to extract file text");
          setSourceText("");
        } finally {
          setExtracting(false);
        }
      })();
      return;
    }

    setError("Unsupported file type. Use .txt, .md, .markdown, .json, .yaml, .yml, .pdf, or .docx");
    setSourceText("");
  }

  async function handleUrlFetch() {
    const url = sourceUrl.trim();
    if (!url) return;

    setFetchingUrl(true);
    setError(null);
    setLastOutcome(null);

    try {
      const { text } = await extractUrlText({ url });
      setSourceText(text);
      setIsFirecrawlPrepped(true);
      // Derive filename from URL hostname + timestamp
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      setFileName(`${hostname}_${ts}.md`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch URL");
      setSourceText("");
      setIsFirecrawlPrepped(false);
    } finally {
      setFetchingUrl(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-4 text-sm font-semibold text-text">
          Upload a compliance document
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          First run? Load a sample, parse it, then continue to Chunk and Watermark in Documents.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button type="button"
            onClick={() => {
              setSourceText(SAMPLE_DOCUMENT_TEXT);
              setFileName("sample-compliance-policy.md");
              setError(null);
            }}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
          >
            Use sample document
          </button>
        </div>

        {/* URL fetch (Firecrawl) */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-text-muted">
            Fetch from URL (PDF, web page)
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://example.com/document.pdf"
              className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
              disabled={fetchingUrl}
            />
            <button
              type="button"
              onClick={handleUrlFetch}
              disabled={!sourceUrl.trim() || fetchingUrl}
              className="rounded-md bg-corpus-600 px-4 py-2 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
            >
              {fetchingUrl ? "Fetching..." : "Fetch"}
            </button>
          </div>
          {fetchingUrl && (
            <p className="mt-1 text-xs text-text-muted">Extracting document via Firecrawl...</p>
          )}
        </div>

        <div className="mb-4 flex items-center gap-4">
          {/* File input */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,.json,.yaml,.yml,.pdf,.docx"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-muted hover:bg-surface-alt"
            >
              Or choose file
            </button>
          </div>
          {fileName && (
            <span className="text-sm text-text-muted">{fileName}</span>
          )}
          {extracting && (
            <span className="text-xs text-text-muted">Extracting text...</span>
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

        <div className="mb-4 rounded-md border border-border bg-surface-alt/30 p-3 space-y-2">
          {isFirecrawlPrepped && (
            <div className="flex items-center gap-2 text-xs text-corpus-600 font-medium">
              <span className="inline-block h-2 w-2 rounded-full bg-corpus-500" />
              Firecrawl-prepped — AI will generate frontmatter only (body already clean)
            </div>
          )}
          {!isFirecrawlPrepped && (
            <>
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={isPublishedStandard}
                  onChange={(e) => setIsPublishedStandard(e.target.checked)}
                  className="h-4 w-4"
                />
                This upload is a published standard / primary source text
              </label>
              <p className="text-xs text-text-muted">
                Checked = strict fidelity prompt. Unchecked = interpretation/secondary-source prompt.
              </p>
            </>
          )}
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
        <button type="button"
          onClick={handleParse}
          disabled={!sourceText.trim() || submitting || extracting || fetchingUrl}
          className="rounded-md bg-corpus-600 px-6 py-2 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
        >
          {extracting ? "Extracting..." : fetchingUrl ? "Fetching..." : submitting ? "Uploading..." : isFirecrawlPrepped ? "Parse (Frontmatter Only)" : "Parse Document"}
        </button>

        {lastOutcome && (
          <p className="mt-3 text-xs text-emerald-700">{lastOutcome}</p>
        )}
      </div>
    </div>
  );
}
