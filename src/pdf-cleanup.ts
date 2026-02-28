const PDF_NOISE_LINE_PATTERNS: RegExp[] = [
  /^SNV\s*\/\s*licensed to\s+/i,
  /^COPYRIGHT PROTECTED DOCUMENT$/i,
  /^ISO copyright office$/i,
  /^CP\s*401\b/i,
  /^CH-?1214\b/i,
  /^Phone:\s*\+/i,
  /^Email:\s*/i,
  /^Website:\s*/i,
  /^Published in Switzerland$/i,
  /^Price based on \d+ pages$/i,
  /^Reference number$/i,
  /^INTERNATIONAL\s+STANDARD$/i,
  /^ICS\s+[0-9.;\s\t-]+$/i,
  /^Table\s+A\.1\s*\(continued\)/i,
  /^©\s*ISO\/IEC\s*20\d{2}\s*[–-]\s*All rights reserved$/i,
];

function normalizeWhitespace(line: string): string {
  return line.replace(/\s+/g, " ").trim().toLowerCase();
}

function collapseSpacedLetters(line: string): string {
  return line.replace(/\b(?:[A-Za-z]\s+){3,}[A-Za-z]\b/g, (match) =>
    match.replace(/\s+/g, ""),
  );
}

function normalizeClauseNumberSpacing(line: string): string {
  return line.replace(/(\d\.)\s+(\d)/g, "$1$2");
}

function normalizeExtractedPdfLine(line: string): string {
  let normalized = line.replace(/\u00A0/g, " ").replace(/[\t\f\v]+/g, " ");
  normalized = collapseSpacedLetters(normalized);
  normalized = normalized.replace(/\bAnnex([A-Z])\b/g, "Annex $1");
  normalized = normalizeClauseNumberSpacing(normalized);
  normalized = normalized.replace(/\s{2,}/g, " ");
  return normalized.trimEnd();
}

function isLikelyPageMarker(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^\d{1,3}$/.test(trimmed)) return true;
  if (/^[ivxlcdm]{1,8}$/i.test(trimmed)) return true;
  return false;
}

function isLikelyTableOfContentsLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (/\.{3,}\s*\d+\s*$/.test(trimmed)) return true;

  if (/^(?:[A-Za-z]\s+)?\d+(?:\.\d+)*\s+.+\s+\d{1,3}$/.test(trimmed)) return true;

  if (/^(?:Annex|Bibliography|Foreword|Introduction|Scope|Normative references|Terms and definitions)\b.*\d{1,3}\s*$/i.test(trimmed)) {
    return true;
  }

  return false;
}

function isStructuralNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (/^Contents\s+Page$/i.test(trimmed)) return true;
  if (/^Reference number$/i.test(trimmed)) return true;

  return false;
}

export interface PdfCleanupTelemetry {
  originalChars: number;
  cleanedChars: number;
  removedChars: number;
  removedCharRatio: number;
  originalLines: number;
  cleanedLines: number;
  removedLines: number;
  removedByRule: {
    structural: number;
    knownNoise: number;
    pageMarker: number;
    tableOfContents: number;
    repeatedHeaderFooter: number;
  };
}

export function cleanExtractedPdfTextWithTelemetry(raw: string): {
  text: string;
  telemetry: PdfCleanupTelemetry;
} {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => normalizeExtractedPdfLine(line));

  const frequency = new Map<string, number>();
  for (const line of lines) {
    const key = normalizeWhitespace(line);
    if (!key) continue;
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }

  const removedByRule = {
    structural: 0,
    knownNoise: 0,
    pageMarker: 0,
    tableOfContents: 0,
    repeatedHeaderFooter: 0,
  };

  const filtered: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      filtered.push(line);
      continue;
    }

    if (isStructuralNoiseLine(trimmed)) {
      removedByRule.structural += 1;
      continue;
    }

    if (PDF_NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      removedByRule.knownNoise += 1;
      continue;
    }

    if (isLikelyPageMarker(trimmed)) {
      removedByRule.pageMarker += 1;
      continue;
    }

    if (isLikelyTableOfContentsLine(trimmed)) {
      removedByRule.tableOfContents += 1;
      continue;
    }

    const key = normalizeWhitespace(trimmed);
    const appearsOften = (frequency.get(key) ?? 0) >= 3;
    if (appearsOften) {
      if (
        key.includes("iso/iec 27001:2022") ||
        key.includes("snv / licensed to") ||
        key.includes("all rights reserved")
      ) {
        removedByRule.repeatedHeaderFooter += 1;
        continue;
      }
    }

    filtered.push(line);
  }

  const text = filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const originalChars = normalized.length;
  const cleanedChars = text.length;
  const originalLines = lines.length;
  const cleanedLines = text ? text.split("\n").length : 0;
  const removedChars = Math.max(0, originalChars - cleanedChars);
  const removedLines = Math.max(0, originalLines - cleanedLines);

  return {
    text,
    telemetry: {
      originalChars,
      cleanedChars,
      removedChars,
      removedCharRatio: originalChars > 0 ? removedChars / originalChars : 0,
      originalLines,
      cleanedLines,
      removedLines,
      removedByRule,
    },
  };
}

export function cleanExtractedPdfText(raw: string): string {
  return cleanExtractedPdfTextWithTelemetry(raw).text;
}