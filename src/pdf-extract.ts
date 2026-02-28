export type PdfExtractorMode = "auto" | "pdfjs" | "pdfparse";
export type PdfExtractor = "pdfjs" | "pdfparse";

interface PdfJsTextItem {
  str?: string;
  width?: number;
  hasEOL?: boolean;
  transform?: number[];
}

interface PdfJsTextContent {
  items?: PdfJsTextItem[];
}

interface PdfJsPage {
  getTextContent: () => Promise<PdfJsTextContent>;
}

interface PdfJsDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
}

interface PdfJsLoadingTask {
  promise: Promise<PdfJsDocument>;
}

interface PdfJsModule {
  getDocument: (init: Record<string, unknown>) => PdfJsLoadingTask;
}

type Logger = Pick<Console, "warn">;

export function parsePdfExtractorMode(value: string | undefined): PdfExtractorMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "auto";
  if (normalized === "auto" || normalized === "pdfjs" || normalized === "pdfparse") {
    return normalized;
  }
  return "auto";
}

function findNearestRowKey(rowKeys: number[], y: number, tolerance: number): number | undefined {
  for (const key of rowKeys) {
    if (Math.abs(key - y) <= tolerance) {
      return key;
    }
  }
  return undefined;
}

function extractLinesFromPdfJsItems(items: PdfJsTextItem[]): string[] {
  const rows = new Map<number, PdfJsTextItem[]>();
  const rowKeys: number[] = [];
  const rowTolerance = 2;

  for (const item of items) {
    const text = item.str?.trim();
    if (!text) continue;

    const transform = item.transform;
    if (!Array.isArray(transform) || transform.length < 6) continue;
    const y = Number(transform[5] ?? 0);

    const rowKey = findNearestRowKey(rowKeys, y, rowTolerance) ?? y;
    if (!rows.has(rowKey)) {
      rows.set(rowKey, []);
      rowKeys.push(rowKey);
    }
    rows.get(rowKey)!.push(item);
  }

  rowKeys.sort((a, b) => b - a);

  const lines: string[] = [];
  for (const key of rowKeys) {
    const rowItems = rows.get(key)!;
    rowItems.sort((a, b) => {
      const xA = Number(a.transform?.[4] ?? 0);
      const xB = Number(b.transform?.[4] ?? 0);
      return xA - xB;
    });

    let line = "";
    let prevEndX: number | null = null;

    for (const item of rowItems) {
      const chunk = (item.str ?? "").trim();
      if (!chunk) continue;

      const x = Number(item.transform?.[4] ?? 0);
      const width = Number(item.width ?? Math.max(1, chunk.length * 2));

      if (prevEndX !== null && x - prevEndX > 1.5) {
        line += " ";
      }
      line += chunk;
      prevEndX = x + width;

      if (item.hasEOL) {
        const normalizedLine = line.replace(/\s+/g, " ").trim();
        if (normalizedLine) lines.push(normalizedLine);
        line = "";
        prevEndX = null;
      }
    }

    const normalizedLine = line.replace(/\s+/g, " ").trim();
    if (normalizedLine) lines.push(normalizedLine);
  }

  return lines;
}

async function extractWithPdfJs(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as PdfJsModule;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = extractLinesFromPdfJsItems(content.items ?? []);
    pages.push(lines.join("\n"));
  }

  return pages.join("\n\n").trim();
}

async function extractWithPdfParse(buffer: Buffer): Promise<string> {
  const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (pdfParseModule as { default?: (input: Buffer) => Promise<{ text?: string }> }).default;
  if (!pdfParse) {
    throw new Error("PDF parser is unavailable in this runtime");
  }
  const parsed = await pdfParse(buffer);
  return (parsed.text ?? "").trim();
}

function ensureNonEmptyExtractedText(text: string, extractor: PdfExtractor): string {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error(`${extractor} produced empty text`);
  }
  return normalized;
}

export async function extractPdfText(
  buffer: Buffer,
  options?: {
    mode?: PdfExtractorMode;
    logger?: Logger;
  },
): Promise<{
  text: string;
  extractor: PdfExtractor;
  fallbackUsed: boolean;
}> {
  const mode = options?.mode ?? "auto";
  const logger = options?.logger;

  if (mode === "pdfjs") {
    const text = ensureNonEmptyExtractedText(await extractWithPdfJs(buffer), "pdfjs");
    return { text, extractor: "pdfjs", fallbackUsed: false };
  }

  if (mode === "pdfparse") {
    const text = ensureNonEmptyExtractedText(await extractWithPdfParse(buffer), "pdfparse");
    return { text, extractor: "pdfparse", fallbackUsed: false };
  }

  try {
    const text = ensureNonEmptyExtractedText(await extractWithPdfJs(buffer), "pdfjs");
    return { text, extractor: "pdfjs", fallbackUsed: false };
  } catch (error) {
    logger?.warn("[pdf-extract] pdfjs failed, falling back to pdf-parse", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    const text = ensureNonEmptyExtractedText(await extractWithPdfParse(buffer), "pdfparse");
    return { text, extractor: "pdfparse", fallbackUsed: true };
  }
}