/**
 * Server functions for corpus session management.
 *
 * All functions authenticate via Supabase cookies, then use the
 * service_role client for DB operations (bypasses RLS for MVP).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  MissingEnvironmentError,
  getSupabaseServer,
  getSupabaseService,
} from "@/lib/supabase";

import {
  createSession as createSessionFn,
  getSession as getSessionFn,
  listSessions as listSessionsFn,
  getSessionDocuments,
  insertDocumentForParse as insertDocumentForParseFn,
  saveDocumentEdit as saveDocumentEditFn,
  deleteDocument as deleteDocumentFn,
  chunkDocument as chunkDocumentFn,
  watermarkDocument as watermarkDocumentFn,
  markSessionComplete as markSessionCompleteFn,
  saveCrosswalkEdit as saveCrosswalkEditFn,
  updateSessionName as updateSessionNameFn,
  deleteSession as deleteSessionFn,
  setSessionPublic as setSessionPublicFn,
  recordSessionQualitySnapshot as recordSessionQualitySnapshotFn,
} from "@pipeline/sessions";
import {
  reparseDocument as reparseDocumentFn,
  generateCrosswalk as generateCrosswalkFn,
} from "@pipeline/sessions";
import {
  promoteToEncyclopedia as promoteToEncyclopediaFn,
  listEncyclopedia as listEncyclopediaFn,
  removeEncyclopediaEntry as removeEncyclopediaEntryFn,
  generateEncyclopediaCrosswalk as generateEncyclopediaCrosswalkFn,
} from "@pipeline/encyclopedia";

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "yaml", "yml"]);

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

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

function normalizeWhitespace(line: string): string {
  return line.replace(/\s+/g, " ").trim().toLowerCase();
}

function collapseSpacedLetters(line: string): string {
  return line.replace(/\b(?:[A-Za-z]\s+){3,}[A-Za-z]\b/g, (match) =>
    match.replace(/\s+/g, ""),
  );
}

function normalizeClauseNumberSpacing(line: string): string {
  // Fix OCR/extraction artifacts like "7. 2" -> "7.2" and "6.1. 3" -> "6.1.3".
  return line.replace(/(\d\.)\s+(\d)/g, "$1$2");
}

function normalizeExtractedPdfLine(line: string): string {
  let normalized = line.replace(/\u00A0/g, " ").replace(/[\t\f\v]+/g, " ");
  normalized = collapseSpacedLetters(normalized);
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

  // Dotted leader rows common in generated PDF contents pages.
  if (/\.{3,}\s*\d+\s*$/.test(trimmed)) return true;

  // Numbered heading + trailing page number pattern.
  if (/^(?:[A-Za-z]\s+)?\d+(?:\.\d+)*\s+.+\s+\d{1,3}$/.test(trimmed)) return true;

  // Clause list rows with repeated spacing and page number.
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

export function cleanExtractedPdfText(raw: string): string {
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

  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;

    if (isStructuralNoiseLine(trimmed)) {
      return false;
    }

    if (PDF_NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      return false;
    }

    if (isLikelyPageMarker(trimmed)) {
      return false;
    }

    if (isLikelyTableOfContentsLine(trimmed)) {
      return false;
    }

    const key = normalizeWhitespace(trimmed);
    const appearsOften = (frequency.get(key) ?? 0) >= 3;
    if (!appearsOften) return true;

    // Strip highly repeated running headers/footers only.
    if (
      key.includes("iso/iec 27001:2022") ||
      key.includes("snv / licensed to") ||
      key.includes("all rights reserved")
    ) {
      return false;
    }

    return true;
  });

  return filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractTextFromUpload(data: {
  fileName: string;
  fileBase64: string;
}): Promise<string> {
  const ext = getExtension(data.fileName);
  const buffer = Buffer.from(data.fileBase64, "base64");

  if (TEXT_EXTENSIONS.has(ext)) {
    return buffer.toString("utf8");
  }

  if (ext === "pdf") {
    const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = (pdfParseModule as { default?: (input: Buffer) => Promise<{ text?: string }> }).default;
    if (!pdfParse) {
      throw new Error("PDF parser is unavailable in this runtime");
    }
    const parsed = await pdfParse(buffer);
    return cleanExtractedPdfText(parsed.text ?? "");
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value ?? "";
  }

  throw new Error("Unsupported file type. Use .txt, .md, .markdown, .json, .yaml, .yml, .pdf, or .docx");
}

function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Missing OPENROUTER_API_KEY environment variable");
  return key;
}

// ─── Auth helper ────────────────────────────────────────────────────────────

async function requireUser() {
  const request = getRequest();
  const { client } = getSupabaseServer(request);
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  return user;
}

// ─── Session CRUD ───────────────────────────────────────────────────────────

export const createSession = createServerFn({ method: "POST" })
  .inputValidator((data: { name?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    const session = await createSessionFn(service, {
      name: data.name ?? "Untitled Session",
      userId: user.id,
    });

    return { sessionId: session.id };
  });

export const getSessions = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    const service = getSupabaseService();

    const sessions = await listSessionsFn(service);
    // Filter to user's sessions (MVP: no org scoping)
    return sessions.filter((s) => s.created_by === user.id);
  },
);

export const getSessionWithDocuments = createServerFn({ method: "GET" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();

    const session = await getSessionFn(service, data.sessionId);
    const documents = await getSessionDocuments(service, data.sessionId);

    return { session, documents };
  });

export const renameSession = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; name: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();
    await updateSessionNameFn(service, data.sessionId, data.name);
  });

export const removeSession = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();
    await deleteSessionFn(service, data.sessionId);
  });

// ─── Document operations ────────────────────────────────────────────────────

export const uploadAndParse = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      sessionId: string;
      sourceText: string;
      sourceFileName?: string;
      hints?: {
        tier?: string;
        frameworks?: string[];
        industries?: string[];
        sourceUrl?: string;
        sourcePublisher?: string;
      };
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    const { documentId, sortOrder } = await insertDocumentForParseFn(
      service,
      data.sessionId,
      data.sourceText,
      {
        sourceFileName: data.sourceFileName,
        userId: user.id,
      },
    );

    return { documentId, sortOrder };
  });

export const insertDocForParse = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      sessionId: string;
      sourceText: string;
      sourceFileName?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    return await insertDocumentForParseFn(service, data.sessionId, data.sourceText, {
      sourceFileName: data.sourceFileName,
      userId: user.id,
    });
  });

export const extractUploadText = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      fileName: string;
      fileBase64: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireUser();
    const text = await extractTextFromUpload(data);
    if (!text.trim()) {
      throw new Error("No extractable text found in uploaded file");
    }
    return { text };
  });

export const reparseDocument = createServerFn({ method: "POST" })
  .inputValidator((data: {
    documentId: string;
    parsePromptProfile?: "published_standard" | "interpretation";
  }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();

    // Parse inline — reparseDocumentFn sets status to "parsing" internally
    const result = await reparseDocumentFn(service, data.documentId, {
      openrouterApiKey: getOpenRouterKey(),
      parsePromptProfile: data.parsePromptProfile,
    });

    return { documentId: data.documentId, model: result.model };
  });

export const saveEdit = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string; userMarkdown: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();
    await saveDocumentEditFn(service, data.documentId, data.userMarkdown);
  });

export const removeDocument = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();
    await deleteDocumentFn(service, data.documentId);
  });

// ─── Chunk & Watermark ──────────────────────────────────────────────────────

export const chunkDoc = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();
    return await chunkDocumentFn(service, data.documentId);
  });

export const watermarkDoc = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();
    return await watermarkDocumentFn(service, data.documentId);
  });

// ─── Session workflow ───────────────────────────────────────────────────────

export const markComplete = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();
    await markSessionCompleteFn(service, data.sessionId);
  });

export const generateCrosswalk = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();

    // Generate crosswalk inline — sets session status internally
    const result = await generateCrosswalkFn(service, data.sessionId, {
      openrouterApiKey: getOpenRouterKey(),
    });

    return { sessionId: data.sessionId, model: result.model };
  });

export const saveCrosswalkEdit = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; markdown: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const service = getSupabaseService();
    await saveCrosswalkEditFn(service, data.sessionId, data.markdown);
  });

export const recordSessionQualitySnapshot = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      sessionId: string;
      metrics: {
        quality: {
          parseAccuracy: number;
          chunkCoverage: number;
          watermarkIntegrity: number;
          promotionReadiness: number;
          overall: number;
        };
        gatePass: {
          parse: boolean;
          chunk: boolean;
          watermark: boolean;
          promote: boolean;
        };
        counts: {
          totalDocs: number;
          promotedWatermarkedDocs: number;
        };
        canGenerateCrosswalk: boolean;
        sessionStatus: "uploading" | "complete" | "crosswalk_pending" | "crosswalk_done" | "archived";
        crosswalkPresent: boolean;
      };
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    const session = await getSessionFn(service, data.sessionId);
    if (session.created_by !== user.id) {
      throw new Error("Not authorized");
    }

    return await recordSessionQualitySnapshotFn(service, data.sessionId, data.metrics, user.id);
  });

// ─── Public sharing ──────────────────────────────────────────────────────

export const toggleSessionPublic = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; isPublic: boolean }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    const session = await getSessionFn(service, data.sessionId);
    if (session.created_by !== user.id) {
      throw new Error("Not authorized");
    }

    await setSessionPublicFn(service, data.sessionId, data.isPublic);
  });

export const getPublicSessionData = createServerFn({ method: "GET" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    const service = getSupabaseService();

    // Uniform error for missing OR private sessions (no info leak)
    let session: Awaited<ReturnType<typeof getSessionFn>>;
    try {
      session = await getSessionFn(service, data.sessionId);
    } catch {
      throw new Error("Session not found");
    }
    if (!session.is_public) {
      throw new Error("Session not found");
    }

    const documents = await getSessionDocuments(service, data.sessionId);

    // Strip source_text from public responses
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const safeDocuments = documents.map(({ source_text, ...d }) => d);

    return { session, documents: safeDocuments };
  });

// ─── Encyclopedia ────────────────────────────────────────────────────────────

export const promoteDoc = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();
    return await promoteToEncyclopediaFn(service, data.documentId, user.id);
  });

export const getEncyclopedia = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    const service = getSupabaseService();
    return await listEncyclopediaFn(service, user.id);
  },
);

export const removeEncyclopediaEntry = createServerFn({ method: "POST" })
  .inputValidator((data: { entryId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    // Verify ownership before deleting
    const { data: entry } = await service
      .from("corpus_encyclopedia")
      .select("created_by")
      .eq("id", data.entryId)
      .single();

    if (!entry || entry.created_by !== user.id) {
      throw new Error("Not authorized");
    }

    await removeEncyclopediaEntryFn(service, data.entryId);
  });

export const generateEncyclopediaCrosswalk = createServerFn({ method: "POST" })
  .inputValidator((data: { entryIds: string[] }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    const result = await generateEncyclopediaCrosswalkFn(
      service,
      data.entryIds,
      user.id,
      { openrouterApiKey: getOpenRouterKey() },
    );

    return result;
  });

// ─── Auth ───────────────────────────────────────────────────────────────────

export const getUser = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const request = getRequest();
    const { client } = getSupabaseServer(request);
    const {
      data: { user },
    } = await client.auth.getUser();

    return user
      ? { id: user.id, email: user.email ?? "", authenticated: true }
      : { id: "", email: "", authenticated: false };
  } catch (error) {
    if (error instanceof MissingEnvironmentError) {
      return { id: "", email: "", authenticated: false };
    }
    throw error;
  }
});
