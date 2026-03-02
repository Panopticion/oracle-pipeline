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
import type { CorpusSession, SessionDocument } from "@pipeline/types";
import {
  generateCrosswalk as generateCrosswalkFn,
} from "@pipeline/sessions";
import { enqueueJob } from "@pipeline/job-queue";
import { extractPdfText, parsePdfExtractorMode } from "@pipeline/pdf-extract";
import { cleanExtractedPdfTextWithTelemetry } from "@pipeline/pdf-cleanup";
import {
  promoteToEncyclopedia as promoteToEncyclopediaFn,
  listEncyclopedia as listEncyclopediaFn,
  removeEncyclopediaEntry as removeEncyclopediaEntryFn,
  generateEncyclopediaCrosswalk as generateEncyclopediaCrosswalkFn,
} from "@pipeline/encyclopedia";
import {
  type GlobalStateActionRequest,
  type GlobalStateActionResponse,
  type GlobalStateQuery,
  type GlobalStateResponse,
  type ServerErrorEnvelope,
  type ServerResult,
} from "@/lib/global-state-types";
import { loadGlobalDocumentState } from "@/server/global-state-service";

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "yaml", "yml"]);

type DomainErrorCode =
  | "AUTH_UNAUTHENTICATED"
  | "AUTH_FORBIDDEN"
  | "RESOURCE_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "DEPENDENCY_ERROR";

class DomainError extends Error {
  code: DomainErrorCode;
  status: number;

  constructor(code: DomainErrorCode, message: string, status: number) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: DomainErrorCode, message: string, status: number): never {
  throw new DomainError(code, message, status);
}

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx + 1).toLowerCase();
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
    const extractorMode = parsePdfExtractorMode(process.env.PDF_EXTRACTOR);
    const extracted = await extractPdfText(buffer, {
      mode: extractorMode,
      logger: console,
    });
    const { text, telemetry } = cleanExtractedPdfTextWithTelemetry(extracted.text);
    console.info("[pdf-cleanup]", {
      fileName: data.fileName,
      extractorMode,
      extractorUsed: extracted.extractor,
      fallbackUsed: extracted.fallbackUsed,
      ...telemetry,
    });
    return text;
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
  if (!key) {
    fail("DEPENDENCY_ERROR", "Missing OPENROUTER_API_KEY environment variable", 500);
  }
  return key;
}

function toErrorEnvelope(error: unknown): ServerErrorEnvelope {
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  if (error instanceof MissingEnvironmentError) {
    return {
      code: "DEPENDENCY_ERROR",
      message: error.message,
      status: 500,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : "Unexpected server error",
    status: 500,
  };
}

async function asServerResult<T>(run: () => Promise<T>): Promise<ServerResult<T>> {
  try {
    const data = await run();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toErrorEnvelope(error) };
  }
}

// ─── Auth helper ────────────────────────────────────────────────────────────

async function requireUser() {
  const request = getRequest();
  const { client } = getSupabaseServer(request);
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    fail("AUTH_UNAUTHENTICATED", "Not authenticated", 401);
  }

  return user;
}

async function requireOwnedSession(
  service: ReturnType<typeof getSupabaseService>,
  sessionId: string,
  userId: string,
): Promise<CorpusSession> {
  let session: CorpusSession;
  try {
    session = await getSessionFn(service, sessionId);
  } catch {
    fail("RESOURCE_NOT_FOUND", "Session not found", 404);
  }
  if (session.created_by !== userId) {
    fail("AUTH_FORBIDDEN", "Not authorized", 403);
  }
  return session;
}

async function requireOwnedDocument(
  service: ReturnType<typeof getSupabaseService>,
  documentId: string,
  userId: string,
): Promise<SessionDocument> {
  const { data: document, error } = await service
    .from("corpus_session_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !document) {
    fail("RESOURCE_NOT_FOUND", "Document not found", 404);
  }

  await requireOwnedSession(service, document.session_id as string, userId);

  return document as SessionDocument;
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
    const user = await requireUser();
    const service = getSupabaseService();

    const session = await requireOwnedSession(service, data.sessionId, user.id);
    const documents = await getSessionDocuments(service, data.sessionId);

    return { session, documents };
  });

export const getSessionWithDocumentsResult = createServerFn({ method: "GET" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      const session = await requireOwnedSession(service, data.sessionId, user.id);
      const documents = await getSessionDocuments(service, data.sessionId);
      return { session, documents };
    }),
  );

export const getGlobalDocumentState = createServerFn({ method: "GET" })
  .inputValidator((data: GlobalStateQuery | undefined) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    try {
      return await loadGlobalDocumentState({
        service,
        userId: user.id,
        query: data,
      });
    } catch (error) {
      const envelope = toErrorEnvelope(error);
      fail(
        envelope.code === "UNKNOWN_ERROR" ? "DEPENDENCY_ERROR" : envelope.code,
        envelope.message,
        envelope.status,
      );
    }
  });

export const getGlobalDocumentStateResult = createServerFn({ method: "GET" })
  .inputValidator((data: GlobalStateQuery | undefined) => data)
  .handler(async ({ data }) =>
    asServerResult<GlobalStateResponse>(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      return await loadGlobalDocumentState({ service, userId: user.id, query: data });
    }),
  );

export const runGlobalStateAction = createServerFn({ method: "POST" })
  .inputValidator((data: GlobalStateActionRequest) => data)
  .handler(async ({ data }) =>
    asServerResult<GlobalStateActionResponse>(async () => {
      const user = await requireUser();
      const service = getSupabaseService();

      await requireOwnedDocument(service, data.documentId, user.id);

      if (data.action === "parse") {
        const model = process.env.PARSE_MODEL_DEFAULT;

        await service
          .from("corpus_session_documents")
          .update({
            status: "parsing",
            error_message: null,
            ...(model ? { parse_model: model } : {}),
          })
          .eq("id", data.documentId);

        const jobId = await enqueueJob(service, "parse_document", {
          documentId: data.documentId,
          parsePromptProfile: data.parsePromptProfile,
        });

        return {
          documentId: data.documentId,
          action: "parse",
          status: "started",
          jobId,
        };
      }

      if (data.action === "stop_parse") {
        const { data: activeJob, error: activeJobError } = await service
          .from("corpus_jobs")
          .select("id")
          .eq("kind", "parse_document")
          .contains("payload", { documentId: data.documentId })
          .in("status", ["pending", "in_progress"])
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (activeJobError) {
          fail("DEPENDENCY_ERROR", `Failed to locate parse job: ${activeJobError.message}`, 500);
        }

        if (!activeJob) {
          return {
            documentId: data.documentId,
            action: "stop_parse",
            status: "completed",
          };
        }

        const cancelledAt = new Date().toISOString();

        const { error: cancelJobError } = await service
          .from("corpus_jobs")
          .update({
            status: "failed",
            error: "Cancelled by user",
            result: {
              step: "cancelled",
              message: "Cancelled by user",
              updatedAt: cancelledAt,
            },
          })
          .eq("id", activeJob.id)
          .in("status", ["pending", "in_progress"]);

        if (cancelJobError) {
          fail("DEPENDENCY_ERROR", `Failed to cancel parse job: ${cancelJobError.message}`, 500);
        }

        const { error: documentError } = await service
          .from("corpus_session_documents")
          .update({
            status: "failed",
            error_message: "Parse cancelled by user",
          })
          .eq("id", data.documentId)
          .in("status", ["pending", "parsing"]);

        if (documentError) {
          fail("DEPENDENCY_ERROR", `Failed to mark document cancelled: ${documentError.message}`, 500);
        }

        return {
          documentId: data.documentId,
          action: "stop_parse",
          status: "completed",
          jobId: activeJob.id,
        };
      }

      if (data.action === "chunk") {
        const result = await chunkDocumentFn(service, data.documentId);
        return {
          documentId: data.documentId,
          action: "chunk",
          status: "completed",
          chunkCount: result.chunkCount,
        };
      }

      await watermarkDocumentFn(service, data.documentId);
      return {
        documentId: data.documentId,
        action: "watermark",
        status: "completed",
      };
    }),
  );

export const renameSession = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; name: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();
    await requireOwnedSession(service, data.sessionId, user.id);
    await updateSessionNameFn(service, data.sessionId, data.name);
  });

export const renameSessionResult = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; name: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedSession(service, data.sessionId, user.id);
      await updateSessionNameFn(service, data.sessionId, data.name);
      return { renamed: true };
    }),
  );

export const removeSession = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();
    await requireOwnedSession(service, data.sessionId, user.id);
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

    await requireOwnedSession(service, data.sessionId, user.id);

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

    await requireOwnedSession(service, data.sessionId, user.id);

    return await insertDocumentForParseFn(service, data.sessionId, data.sourceText, {
      sourceFileName: data.sourceFileName,
      userId: user.id,
    });
  });

export const insertDocForParseResult = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      sessionId: string;
      sourceText: string;
      sourceFileName?: string;
    }) => data,
  )
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedSession(service, data.sessionId, user.id);
      return await insertDocumentForParseFn(service, data.sessionId, data.sourceText, {
        sourceFileName: data.sourceFileName,
        userId: user.id,
      });
    }),
  );

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

export const extractUploadTextResult = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      fileName: string;
      fileBase64: string;
    }) => data,
  )
  .handler(async ({ data }) =>
    asServerResult(async () => {
      await requireUser();
      const text = await extractTextFromUpload(data);
      if (!text.trim()) {
        fail("VALIDATION_ERROR", "No extractable text found in uploaded file", 400);
      }
      return { text };
    }),
  );

export const reparseDocument = createServerFn({ method: "POST" })
  .inputValidator((data: {
    documentId: string;
    parsePromptProfile?: "published_standard" | "interpretation";
  }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    await requireOwnedDocument(service, data.documentId, user.id);

    const model = process.env.PARSE_MODEL_DEFAULT;

    await service
      .from("corpus_session_documents")
      .update({
        status: "parsing",
        error_message: null,
        ...(model ? { parse_model: model } : {}),
      })
      .eq("id", data.documentId);

    const jobId = await enqueueJob(service, "parse_document", {
      documentId: data.documentId,
      parsePromptProfile: data.parsePromptProfile,
    });

    return { documentId: data.documentId, jobId };
  });

export const reparseDocumentResult = createServerFn({ method: "POST" })
  .inputValidator((data: {
    documentId: string;
    parsePromptProfile?: "published_standard" | "interpretation";
  }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedDocument(service, data.documentId, user.id);

      const model = process.env.PARSE_MODEL_DEFAULT;

      await service
        .from("corpus_session_documents")
        .update({
          status: "parsing",
          error_message: null,
          ...(model ? { parse_model: model } : {}),
        })
        .eq("id", data.documentId);

      const jobId = await enqueueJob(service, "parse_document", {
        documentId: data.documentId,
        parsePromptProfile: data.parsePromptProfile,
      });

      return { documentId: data.documentId, jobId };
    }),
  );

export const stopParseJobResult = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();

      await requireOwnedDocument(service, data.documentId, user.id);

      const { data: activeJob, error: activeJobError } = await service
        .from("corpus_jobs")
        .select("id")
        .eq("kind", "parse_document")
        .contains("payload", { documentId: data.documentId })
        .in("status", ["pending", "in_progress"])
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeJobError) {
        fail("DEPENDENCY_ERROR", `Failed to locate parse job: ${activeJobError.message}`, 500);
      }

      if (!activeJob) {
        return {
          documentId: data.documentId,
          cancelled: false,
          reason: "No active parse job found",
        };
      }

      const cancelledAt = new Date().toISOString();

      const { error: cancelJobError } = await service
        .from("corpus_jobs")
        .update({
          status: "failed",
          error: "Cancelled by user",
          result: {
            step: "cancelled",
            message: "Cancelled by user",
            updatedAt: cancelledAt,
          },
        })
        .eq("id", activeJob.id)
        .in("status", ["pending", "in_progress"]);

      if (cancelJobError) {
        fail("DEPENDENCY_ERROR", `Failed to cancel parse job: ${cancelJobError.message}`, 500);
      }

      const { error: documentError } = await service
        .from("corpus_session_documents")
        .update({
          status: "failed",
          error_message: "Parse cancelled by user",
        })
        .eq("id", data.documentId)
        .in("status", ["pending", "parsing"]);

      if (documentError) {
        fail("DEPENDENCY_ERROR", `Failed to mark document cancelled: ${documentError.message}`, 500);
      }

      return {
        documentId: data.documentId,
        cancelled: true,
        jobId: activeJob.id,
      };
    }),
  );

export const saveEdit = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string; userMarkdown: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();
    await requireOwnedDocument(service, data.documentId, user.id);
    await saveDocumentEditFn(service, data.documentId, data.userMarkdown);
  });

export const saveEditResult = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string; userMarkdown: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedDocument(service, data.documentId, user.id);
      await saveDocumentEditFn(service, data.documentId, data.userMarkdown);
      return { saved: true };
    }),
  );

export const removeDocument = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();
    await requireOwnedDocument(service, data.documentId, user.id);
    await deleteDocumentFn(service, data.documentId);
  });

export const removeDocumentResult = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedDocument(service, data.documentId, user.id);
      await deleteDocumentFn(service, data.documentId);
      return { removed: true };
    }),
  );

// ─── Chunk & Watermark ──────────────────────────────────────────────────────

export const chunkDoc = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();
    await requireOwnedDocument(service, data.documentId, user.id);
    return await chunkDocumentFn(service, data.documentId);
  });

export const chunkDocResult = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedDocument(service, data.documentId, user.id);
      return await chunkDocumentFn(service, data.documentId);
    }),
  );

export const watermarkDoc = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();
    await requireOwnedDocument(service, data.documentId, user.id);
    return await watermarkDocumentFn(service, data.documentId);
  });

export const watermarkDocResult = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedDocument(service, data.documentId, user.id);
      return await watermarkDocumentFn(service, data.documentId);
    }),
  );

// ─── Session workflow ───────────────────────────────────────────────────────

export const markComplete = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();
    await requireOwnedSession(service, data.sessionId, user.id);
    await markSessionCompleteFn(service, data.sessionId);
  });

export const markCompleteResult = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedSession(service, data.sessionId, user.id);
      await markSessionCompleteFn(service, data.sessionId);
      return { completed: true };
    }),
  );

export const generateCrosswalk = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    await requireOwnedSession(service, data.sessionId, user.id);

    // Generate crosswalk inline — sets session status internally
    const result = await generateCrosswalkFn(service, data.sessionId, {
      openrouterApiKey: getOpenRouterKey(),
    });

    return { sessionId: data.sessionId, model: result.model };
  });

export const generateCrosswalkResult = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedSession(service, data.sessionId, user.id);
      const result = await generateCrosswalkFn(service, data.sessionId, {
        openrouterApiKey: getOpenRouterKey(),
      });
      return {
        sessionId: data.sessionId,
        model: result.model,
        crosswalkMarkdown: result.crosswalkMarkdown,
        crosswalkChunks: result.crosswalkChunks,
      };
    }),
  );

export const saveCrosswalkEdit = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; markdown: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();
    await requireOwnedSession(service, data.sessionId, user.id);
    await saveCrosswalkEditFn(service, data.sessionId, data.markdown);
  });

export const saveCrosswalkEditResult = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; markdown: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedSession(service, data.sessionId, user.id);
      await saveCrosswalkEditFn(service, data.sessionId, data.markdown);
      return { saved: true };
    }),
  );

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

    await requireOwnedSession(service, data.sessionId, user.id);

    return await recordSessionQualitySnapshotFn(service, data.sessionId, data.metrics, user.id);
  });

export const recordSessionQualitySnapshotResult = createServerFn({ method: "POST" })
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
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedSession(service, data.sessionId, user.id);
      const snapshot = await recordSessionQualitySnapshotFn(service, data.sessionId, data.metrics, user.id);
      return snapshot;
    }),
  );

// ─── Public sharing ──────────────────────────────────────────────────────

export const toggleSessionPublic = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; isPublic: boolean }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const service = getSupabaseService();

    await requireOwnedSession(service, data.sessionId, user.id);

    await setSessionPublicFn(service, data.sessionId, data.isPublic);
  });

export const toggleSessionPublicResult = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; isPublic: boolean }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedSession(service, data.sessionId, user.id);
      await setSessionPublicFn(service, data.sessionId, data.isPublic);
      return { updated: true };
    }),
  );

export const getPublicSessionData = createServerFn({ method: "GET" })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data }) => {
    const service = getSupabaseService();

    // Uniform error for missing OR private sessions (no info leak)
    let session: Awaited<ReturnType<typeof getSessionFn>>;
    try {
      session = await getSessionFn(service, data.sessionId);
    } catch {
      fail("RESOURCE_NOT_FOUND", "Session not found", 404);
    }
    if (!session.is_public) {
      fail("RESOURCE_NOT_FOUND", "Session not found", 404);
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

    await requireOwnedDocument(service, data.documentId, user.id);

    return await promoteToEncyclopediaFn(service, data.documentId, user.id);
  });

export const promoteDocResult = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      await requireOwnedDocument(service, data.documentId, user.id);
      return await promoteToEncyclopediaFn(service, data.documentId, user.id);
    }),
  );

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
      fail("AUTH_FORBIDDEN", "Not authorized", 403);
    }

    await removeEncyclopediaEntryFn(service, data.entryId);
  });

export const removeEncyclopediaEntryResult = createServerFn({ method: "POST" })
  .inputValidator((data: { entryId: string }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();

      const { data: entry } = await service
        .from("corpus_encyclopedia")
        .select("created_by")
        .eq("id", data.entryId)
        .single();

      if (!entry || entry.created_by !== user.id) {
        fail("AUTH_FORBIDDEN", "Not authorized", 403);
      }

      await removeEncyclopediaEntryFn(service, data.entryId);
      return { removed: true };
    }),
  );

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

export const generateEncyclopediaCrosswalkResult = createServerFn({ method: "POST" })
  .inputValidator((data: { entryIds: string[] }) => data)
  .handler(async ({ data }) =>
    asServerResult(async () => {
      const user = await requireUser();
      const service = getSupabaseService();
      return await generateEncyclopediaCrosswalkFn(
        service,
        data.entryIds,
        user.id,
        { openrouterApiKey: getOpenRouterKey() },
      );
    }),
  );

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
