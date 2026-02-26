/**
 * Document list + editor component with chunk/watermark pipeline stages.
 *
 * Shows all documents in the session. Click to expand.
 * Pipeline flow: parsed/edited → chunk → [review] → watermark → [review/done]
 */

import { useState } from "react";
import { useSessionStore, type SessionDoc, type ChunkData } from "@/lib/stores";
import {
  saveEdit,
  removeDocument,
  reparseDocument,
  chunkDoc,
  watermarkDoc,
} from "@/server/session-actions";

export function DocumentEditor() {
  const store = useSessionStore();
  const [saving, setSaving] = useState<string | null>(null);
  const [reparsing, setReparsing] = useState<string | null>(null);
  const [chunking, setChunking] = useState<string | null>(null);
  const [watermarking, setWatermarking] = useState<string | null>(null);

  if (store.documents.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-12 text-center">
        <p className="text-sm text-text-muted">
          No documents yet. Go to the Upload tab to add compliance documents.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {store.documents.map((doc) => (
        <DocumentCard
          key={doc.id}
          doc={doc}
          isActive={store.activeDocumentId === doc.id}
          onToggle={() =>
            store.setActiveDocument(
              store.activeDocumentId === doc.id ? null : doc.id,
            )
          }
          saving={saving === doc.id}
          reparsing={reparsing === doc.id}
          chunking={chunking === doc.id}
          watermarking={watermarking === doc.id}
          onSave={async (markdown) => {
            setSaving(doc.id);
            try {
              await saveEdit({
                data: { documentId: doc.id, userMarkdown: markdown },
              });
              store.updateDocument(doc.id, {
                userMarkdown: markdown,
                status: "edited",
                chunks: null,
              });
            } finally {
              setSaving(null);
            }
          }}
          onReparse={async () => {
            setReparsing(doc.id);
            // Set local status immediately so UI shows spinner
            store.updateDocument(doc.id, {
              status: "parsing",
              errorMessage: null,
              userMarkdown: null,
              chunks: null,
            });
            setReparsing(null);
            // Fire off parse — polling picks up result when done
            reparseDocument({ data: { documentId: doc.id } }).catch(() => {
              store.updateDocument(doc.id, {
                status: "failed",
                errorMessage: "Parse failed — click Re-parse to retry",
              });
            });
          }}
          onChunk={async () => {
            setChunking(doc.id);
            try {
              const result = await chunkDoc({
                data: { documentId: doc.id },
              });
              store.updateDocument(doc.id, {
                status: "chunked",
                chunks: result.chunks.map((c) => ({
                  sequence: c.sequence,
                  sectionTitle: c.section_title,
                  headingLevel: c.heading_level,
                  content: c.content,
                  contentHash: c.content_hash,
                  tokenCount: c.token_count,
                  headingPath: c.heading_path,
                })),
              });
            } finally {
              setChunking(null);
            }
          }}
          onWatermark={async () => {
            setWatermarking(doc.id);
            try {
              await watermarkDoc({
                data: { documentId: doc.id },
              });
              // Re-fetch the doc to get updated chunks_json with watermarks
              // For now, mark status and let next page load hydrate the data
              store.updateDocument(doc.id, { status: "watermarked" });
            } finally {
              setWatermarking(null);
            }
          }}
          onBackToEdit={() => {
            store.updateDocument(doc.id, {
              status: doc.userMarkdown ? "edited" : "parsed",
              chunks: null,
            });
          }}
          onDelete={async () => {
            await removeDocument({ data: { documentId: doc.id } });
            store.removeDocument(doc.id);
          }}
        />
      ))}
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────────────

const statusBadge: Record<string, { bg: string; label: string }> = {
  pending: { bg: "bg-gray-100 text-gray-600", label: "Pending" },
  parsing: { bg: "bg-yellow-100 text-yellow-700", label: "Parsing..." },
  parsed: { bg: "bg-green-100 text-green-700", label: "Parsed" },
  edited: { bg: "bg-blue-100 text-blue-700", label: "Edited" },
  failed: { bg: "bg-red-100 text-red-700", label: "Failed" },
  chunked: { bg: "bg-purple-100 text-purple-700", label: "Chunked" },
  watermarked: { bg: "bg-emerald-100 text-emerald-700", label: "Watermarked" },
};

// ─── Parsing Indicator ──────────────────────────────────────────────────────

function ParsingIndicator() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="mb-4 flex gap-1.5">
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-corpus-500" />
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-corpus-500 [animation-delay:150ms]" />
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-corpus-500 [animation-delay:300ms]" />
      </div>
      <p className="text-sm font-medium text-text">
        AI parsing in progress...
      </p>
      <p className="mt-1 text-xs text-text-muted">
        Analyzing document structure and generating corpus Markdown with S.I.R.E.
        metadata. This page will update automatically when complete.
      </p>
    </div>
  );
}

// ─── Document Card ───────────────────────────────────────────────────────────

function DocumentCard({
  doc,
  isActive,
  onToggle,
  saving,
  reparsing,
  chunking,
  watermarking,
  onSave,
  onReparse,
  onChunk,
  onWatermark,
  onBackToEdit,
  onDelete,
}: {
  doc: SessionDoc;
  isActive: boolean;
  onToggle: () => void;
  saving: boolean;
  reparsing: boolean;
  chunking: boolean;
  watermarking: boolean;
  onSave: (markdown: string) => Promise<void>;
  onReparse: () => Promise<void>;
  onChunk: () => Promise<void>;
  onWatermark: () => Promise<void>;
  onBackToEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const [editText, setEditText] = useState(
    doc.userMarkdown ?? doc.parsedMarkdown ?? "",
  );

  const badge = statusBadge[doc.status] ?? statusBadge.pending;
  const markdown = doc.userMarkdown ?? doc.parsedMarkdown ?? "";

  const corpusIdMatch = markdown.match(/corpus_id:\s*(.+)/);
  const titleMatch = markdown.match(/title:\s*(.+)/);
  const corpusId = corpusIdMatch?.[1]?.trim() ?? doc.sourceFilename;
  const title = titleMatch?.[1]?.trim() ?? doc.sourceFilename;

  const isChunkOrWatermark = doc.status === "chunked" || doc.status === "watermarked";

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between p-4"
        onClick={onToggle}
      >
        <div>
          <p className="text-sm font-medium text-text">{title}</p>
          <p className="text-xs text-text-muted">{corpusId}</p>
        </div>
        <div className="flex items-center gap-3">
          {doc.chunks && (
            <span className="text-xs text-text-muted">
              {doc.chunks.length} chunks
            </span>
          )}
          {doc.parseModel && (
            <span className="text-xs text-text-muted">{doc.parseModel}</span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.bg} ${
              doc.status === "parsing" ? "animate-pulse" : ""
            }`}
          >
            {badge.label}
          </span>
          <span className="text-text-muted">{isActive ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Expanded content */}
      {isActive && (
        <div className="border-t border-border p-4">
          {doc.errorMessage && (
            <div className="mb-4 rounded-md border border-error/20 bg-error/5 p-3 text-sm text-error">
              {doc.errorMessage}
            </div>
          )}

          {doc.status === "parsing" || doc.status === "pending" ? (
            <ParsingIndicator />
          ) : isChunkOrWatermark ? (
            <ChunkReview
              doc={doc}
              watermarking={watermarking}
              onWatermark={onWatermark}
              onBackToEdit={onBackToEdit}
            />
          ) : (
            <EditView
              doc={doc}
              editText={editText}
              setEditText={setEditText}
              saving={saving}
              reparsing={reparsing}
              chunking={chunking}
              onSave={onSave}
              onReparse={onReparse}
              onChunk={onChunk}
              onDelete={onDelete}
              badge={badge}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Edit View (parsed/edited status) ────────────────────────────────────────

function EditView({
  doc,
  editText,
  setEditText,
  saving,
  reparsing,
  chunking,
  onSave,
  onReparse,
  onChunk,
  onDelete,
  badge,
}: {
  doc: SessionDoc;
  editText: string;
  setEditText: (text: string) => void;
  saving: boolean;
  reparsing: boolean;
  chunking: boolean;
  onSave: (markdown: string) => Promise<void>;
  onReparse: () => Promise<void>;
  onChunk: () => Promise<void>;
  onDelete: () => Promise<void>;
  badge: { bg: string; label: string };
}) {
  const canChunk = doc.status === "parsed" || doc.status === "edited";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Editor (2/3) */}
      <div className="lg:col-span-2">
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          spellCheck={false}
          rows={24}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
        />
      </div>

      {/* Metadata sidebar (1/3) */}
      <div className="space-y-3">
        <MetadataField label="Status" value={badge.label} />
        {doc.parseModel && (
          <MetadataField label="Model" value={doc.parseModel} />
        )}
        {doc.parseTokensIn != null && (
          <MetadataField
            label="Tokens"
            value={`${doc.parseTokensIn.toLocaleString()} in / ${(doc.parseTokensOut ?? 0).toLocaleString()} out`}
          />
        )}
        <MetadataField
          label="Words"
          value={String(editText.split(/\s+/).filter(Boolean).length)}
        />

        <div className="space-y-2 pt-2">
          <button
            onClick={() => onSave(editText)}
            disabled={saving}
            className="w-full rounded-md bg-corpus-600 px-4 py-2 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Edits"}
          </button>

          {canChunk && (
            <button
              onClick={onChunk}
              disabled={chunking}
              className="w-full rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {chunking ? "Chunking..." : "Chunk Document"}
            </button>
          )}

          <button
            onClick={onReparse}
            disabled={reparsing}
            className="w-full rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:bg-surface-alt disabled:opacity-50"
          >
            {reparsing ? "Re-parsing..." : "Re-parse"}
          </button>
          <button
            onClick={onDelete}
            className="w-full rounded-md border border-error/30 px-4 py-2 text-sm text-error hover:bg-error/5"
          >
            Delete Document
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Chunk Review (chunked/watermarked status) ──────────────────────────────

function ChunkReview({
  doc,
  watermarking,
  onWatermark,
  onBackToEdit,
}: {
  doc: SessionDoc;
  watermarking: boolean;
  onWatermark: () => Promise<void>;
  onBackToEdit: () => void;
}) {
  const chunks = doc.chunks ?? [];
  const isWatermarked = doc.status === "watermarked";

  return (
    <div className="space-y-4">
      {/* Pipeline progress */}
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
          Parsed
        </span>
        <span className="text-text-muted">→</span>
        <span
          className={`rounded-full px-2 py-0.5 ${
            isWatermarked
              ? "bg-purple-100 text-purple-700"
              : "bg-purple-600 text-white"
          }`}
        >
          Chunked ({chunks.length})
        </span>
        <span className="text-text-muted">→</span>
        <span
          className={`rounded-full px-2 py-0.5 ${
            isWatermarked
              ? "bg-emerald-600 text-white"
              : "bg-gray-100 text-gray-400"
          }`}
        >
          Watermarked
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        {!isWatermarked && (
          <button
            onClick={onWatermark}
            disabled={watermarking}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {watermarking ? "Watermarking..." : "Watermark Chunks"}
          </button>
        )}
        <button
          onClick={onBackToEdit}
          className="rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:bg-surface-alt"
        >
          Back to Edit
        </button>
        {isWatermarked && (
          <span className="text-xs text-emerald-600 font-medium">
            Ready for download
          </span>
        )}
      </div>

      {/* Chunk list */}
      <div className="space-y-2">
        {chunks.map((chunk) => (
          <ChunkCard key={chunk.sequence} chunk={chunk} isWatermarked={isWatermarked} />
        ))}
      </div>
    </div>
  );
}

// ─── Chunk Card ──────────────────────────────────────────────────────────────

function ChunkCard({
  chunk,
  isWatermarked,
}: {
  chunk: ChunkData;
  isWatermarked: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const wordCount = chunk.content.split(/\s+/).filter(Boolean).length;

  // Check if content has a watermark comment
  const watermarkMatch = chunk.content.match(
    /<!-- corpus-watermark:v1:[^\n]+ -->$/,
  );

  return (
    <div className="rounded-md border border-border bg-surface-alt">
      <div
        className="flex cursor-pointer items-center justify-between px-3 py-2"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-200 text-xs font-mono text-slate-600">
            {String(chunk.sequence).padStart(2, "0")}
          </span>
          <span className="text-sm text-text">{chunk.sectionTitle}</span>
          <span className="text-xs text-text-muted">
            H{chunk.headingLevel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">
            {wordCount} words · ~{chunk.tokenCount} tokens
          </span>
          {isWatermarked && watermarkMatch && (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
              WM
            </span>
          )}
          <span className="text-xs text-text-muted">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-2">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-text">
            {chunk.content}
          </pre>
          {watermarkMatch && (
            <div className="mt-2 rounded bg-emerald-50 px-2 py-1 font-mono text-[10px] text-emerald-700 break-all">
              {watermarkMatch[0]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Metadata Field ──────────────────────────────────────────────────────────

function MetadataField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="text-sm text-text">{value}</p>
    </div>
  );
}
