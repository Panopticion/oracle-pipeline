/**
 * Download bundle component.
 *
 * Generates a ZIP file containing all parsed documents, watermarked chunks,
 * and crosswalk. Uses fflate for client-side ZIP generation.
 */

import { useSessionStore, type SessionDoc } from "@/lib/stores";
import { stripTrailingWatermark } from "@/lib/watermark-utils";
import { zipSync, strToU8 } from "fflate";

export function DownloadBundle() {
  const store = useSessionStore();

  // Include docs that are at least parsed — watermarked docs get chunks in ZIP
  const readyDocs = store.documents.filter(
    (d) =>
      d.status === "parsed" ||
      d.status === "edited" ||
      d.status === "chunked" ||
      d.status === "watermarked",
  );
  const watermarkedDocs = readyDocs.filter((d) => d.status === "watermarked");
  const hasContent = readyDocs.length > 0;

  function getDocMarkdown(doc: SessionDoc): string {
    return doc.userMarkdown ?? doc.parsedMarkdown ?? "";
  }

  function getCorpusId(doc: SessionDoc): string {
    const markdown = getDocMarkdown(doc);
    const match = markdown.match(/corpus_id:\s*(.+)/);
    return match?.[1]?.trim() ?? doc.sourceHash;
  }

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function handleDownload() {
    const sessionSlug = slugify(store.sessionName);
    const files: Record<string, Uint8Array> = {};

    // Add full documents
    readyDocs.forEach((doc, i) => {
      const corpusId = getCorpusId(doc);
      const idx = String(i + 1).padStart(2, "0");
      files[`documents/${idx}-${corpusId}.md`] = strToU8(getDocMarkdown(doc));
    });

    // Add clean + watermarked chunks for docs that completed the pipeline
    watermarkedDocs.forEach((doc) => {
      const corpusId = getCorpusId(doc);
      if (doc.chunks) {
        doc.chunks.forEach((chunk) => {
          const seq = String(chunk.sequence).padStart(3, "0");
          const chunkSlug = slugify(chunk.sectionTitle).slice(0, 40);
          files[`chunks-clean/${corpusId}/${seq}-${chunkSlug}.md`] = strToU8(
            stripTrailingWatermark(chunk.content),
          );
          files[`chunks/${corpusId}/${seq}-${chunkSlug}.md`] = strToU8(
            chunk.content,
          );
        });
      }
    });

    // Add crosswalk (full document + watermarked chunks)
    if (store.crosswalkMarkdown) {
      files["crosswalk/crosswalk-v1.md"] = strToU8(store.crosswalkMarkdown);
    }
    if (store.crosswalkChunks) {
      store.crosswalkChunks.forEach((chunk) => {
        const seq = String(chunk.sequence).padStart(3, "0");
        const chunkSlug = slugify(chunk.sectionTitle).slice(0, 40);
        files[`chunks-clean/crosswalk/${seq}-${chunkSlug}.md`] = strToU8(
          stripTrailingWatermark(chunk.content),
        );
        files[`chunks/crosswalk/${seq}-${chunkSlug}.md`] = strToU8(chunk.content);
      });
    }

    // Add README
    const readme = buildReadme(sessionSlug, readyDocs, watermarkedDocs);
    files["README.md"] = strToU8(readme);

    // Generate ZIP
    const zipped = zipSync(files);
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `corpus-bundle-${sessionSlug}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopyDocument(doc: SessionDoc) {
    navigator.clipboard.writeText(getDocMarkdown(doc));
  }

  function downloadSessionReceipt() {
    const payload = {
      sessionId: store.sessionId,
      sessionName: store.sessionName,
      generatedAt: new Date().toISOString(),
      status: store.sessionStatus,
      counts: {
        documents: store.documents.length,
        readyDocuments: readyDocs.length,
        watermarkedDocuments: watermarkedDocs.length,
        crosswalkPresent: Boolean(store.crosswalkMarkdown),
      },
      documents: store.documents.map((doc) => ({
        id: doc.id,
        sourceFilename: doc.sourceFilename,
        sourceHash: doc.sourceHash,
        status: doc.status,
        chunkCount: doc.chunks?.length ?? 0,
        promotedAt: doc.promotedAt,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `session-receipt-${slugify(store.sessionName)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-2 text-sm font-semibold text-text">
          Download Bundle
        </h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-corpus-100 px-2 py-0.5 text-[11px] font-medium text-corpus-700">
            Provenance-ready
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Audit-friendly
          </span>
          <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[11px] font-medium text-text-muted">
            Export integrity
          </span>
        </div>
        <p className="mb-4 text-xs text-text-muted">
          Download all documents, clean + watermarked chunks, and crosswalk as a ZIP.
          {watermarkedDocs.length < readyDocs.length && (
            <span className="ml-1 text-yellow-600">
              {readyDocs.length - watermarkedDocs.length} doc(s) not yet
              watermarked — chunks will only be included for watermarked
              documents.
            </span>
          )}
        </p>

        {/* File tree preview */}
        <div className="mb-6 rounded-md bg-surface-alt p-4 font-mono text-xs">
          <p className="text-text-muted">
            corpus-bundle-{slugify(store.sessionName)}/
          </p>
          <div className="ml-4 space-y-0.5">
            <p className="text-text-muted">documents/</p>
            {readyDocs.map((doc, i) => (
              <p key={doc.id} className="ml-4 text-text">
                {String(i + 1).padStart(2, "0")}-{getCorpusId(doc)}.md
              </p>
            ))}
            {watermarkedDocs.length > 0 && (
              <>
                <p className="text-text-muted">chunks-clean/</p>
                {watermarkedDocs.map((doc) => (
                  <div key={`${doc.id}-clean`}>
                    <p className="ml-4 text-text-muted">
                      {getCorpusId(doc)}/
                    </p>
                    <p className="ml-8 text-text">
                      {doc.chunks?.length ?? 0} clean chunk
                      {(doc.chunks?.length ?? 0) !== 1 ? "s" : ""}
                    </p>
                  </div>
                ))}
                <p className="text-text-muted">chunks/</p>
                {watermarkedDocs.map((doc) => (
                  <div key={doc.id}>
                    <p className="ml-4 text-text-muted">
                      {getCorpusId(doc)}/
                    </p>
                    <p className="ml-8 text-text">
                      {doc.chunks?.length ?? 0} watermarked chunk
                      {(doc.chunks?.length ?? 0) !== 1 ? "s" : ""}
                    </p>
                  </div>
                ))}
              </>
            )}
            {store.crosswalkMarkdown && (
              <>
                <p className="text-text-muted">crosswalk/</p>
                <p className="ml-4 text-text">crosswalk-v1.md</p>
                {store.crosswalkChunks && (
                  <>
                    <p className="ml-4 text-text-muted">
                      chunks-clean/crosswalk/
                    </p>
                    <p className="ml-8 text-text">
                      {store.crosswalkChunks.length} clean chunk
                      {store.crosswalkChunks.length !== 1 ? "s" : ""}
                    </p>
                    <p className="ml-4 text-text-muted">
                      chunks/crosswalk/
                    </p>
                    <p className="ml-8 text-text">
                      {store.crosswalkChunks.length} watermarked chunk
                      {store.crosswalkChunks.length !== 1 ? "s" : ""}
                    </p>
                  </>
                )}
              </>
            )}
            <p className="text-text">README.md</p>
          </div>
        </div>

        <button
          onClick={handleDownload}
          disabled={!hasContent}
          className="rounded-md bg-corpus-600 px-6 py-2 text-sm font-medium text-white hover:bg-corpus-700 disabled:opacity-50"
        >
          Download ZIP
        </button>

        <button
          onClick={downloadSessionReceipt}
          className="ml-2 rounded-md border border-border px-4 py-2 text-xs text-text-muted hover:bg-surface-alt"
        >
          Download session receipt (JSON)
        </button>

        {!hasContent && (
          <div className="mt-4 rounded-md border border-border bg-surface-alt p-3 text-xs text-text-muted">
            No exportable content yet. Next: parse in Documents, then return here to export.
            <button
              onClick={() => store.setTab("documents")}
              className="ml-2 rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-text hover:bg-surface"
            >
              Go to Documents
            </button>
          </div>
        )}
      </div>

      {/* Individual document copy */}
      {readyDocs.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="mb-4 text-sm font-semibold text-text">
            Copy Individual Documents
          </h2>
          <div className="space-y-2">
            {readyDocs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-md border border-border p-3"
              >
                <div>
                  <p className="text-sm text-text">{getCorpusId(doc)}.md</p>
                  <p className="text-xs text-text-muted">
                    {getDocMarkdown(doc).split(/\s+/).filter(Boolean).length}{" "}
                    words
                    {doc.status === "watermarked" && doc.chunks && (
                      <span className="ml-2 text-emerald-600">
                        {doc.chunks.length} chunks
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => handleCopyDocument(doc)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
                >
                  Copy
                </button>
              </div>
            ))}

            {store.crosswalkMarkdown && (
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm text-text">crosswalk-v1.md</p>
                  <p className="text-xs text-text-muted">
                    {store.crosswalkMarkdown.split(/\s+/).filter(Boolean).length}{" "}
                    words
                    {store.crosswalkChunks && (
                      <span className="ml-2 text-emerald-600">
                        {store.crosswalkChunks.length} watermarked chunks
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(
                      store.crosswalkMarkdown ?? "",
                    )
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── README generator ───────────────────────────────────────────────────────

function buildReadme(
  sessionSlug: string,
  docs: SessionDoc[],
  watermarkedDocs: SessionDoc[],
): string {
  const lines = [
    `# Corpus Bundle: ${sessionSlug}`,
    "",
    `Generated by Panopticon Corpus Pipeline on ${new Date().toISOString().split("T")[0]}`,
    "",
    "## Documents",
    "",
    ...docs.map(
      (d, i) =>
        `${String(i + 1)}. sourceHash: \`${d.sourceHash}\``,
    ),
    "",
  ];

  // Chunks section
  if (watermarkedDocs.length > 0) {
    lines.push(
      "## Chunks",
      "",
      "Each document below has been split into semantic chunks on H2/H3 heading",
      "boundaries, then exported both as clean text (`chunks-clean/`) and",
      "watermarked provenance copies (`chunks/`).",
      "",
      "| Document | Chunks |",
      "|----------|--------|",
      ...watermarkedDocs.map(
        (d) => {
          const markdown = d.userMarkdown ?? d.parsedMarkdown ?? "";
          const match = markdown.match(/corpus_id:\s*(.+)/);
          const cid = match?.[1]?.trim() ?? d.sourceHash;
          return `| ${cid} | ${d.chunks?.length ?? 0} |`;
        },
      ),
      "",
      "### Watermark Verification",
      "",
      "Each chunk contains an HTML comment watermark at the end:",
      "",
      "```",
      "<!-- corpus-watermark:v1:{corpusId}:{sequence}:{signature} -->",
      "```",
      "",
      "Verify integrity with:",
      "",
      "```bash",
      "npx @panopticon/corpus-tools verify chunks/{corpus-id}/000-*.md",
      "```",
      "",
    );
  }

  lines.push(
    "## Usage",
    "",
    "These corpus Markdown files are formatted for the Panopticon vector embedding pipeline.",
    "Each file contains YAML frontmatter with S.I.R.E. metadata for identity-first retrieval.",
    "",
    "Ingest via CLI:",
    "",
    "```bash",
    "npx @panopticon/corpus-pipeline --action ingest_and_embed",
    "```",
    "",
  );

  return lines.join("\n");
}
