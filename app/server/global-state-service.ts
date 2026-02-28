import type { SupabaseClient } from "@supabase/supabase-js";
import { listSessions as listSessionsFn } from "@pipeline/sessions";
import type { CorpusSession, SessionDocument, SessionDocumentStatus } from "@pipeline/types";
import { parseCorpusContent } from "@pipeline/content-helpers";
import { verifyChunkWatermark } from "@pipeline/watermark";
import type {
  GlobalStateDocumentRow,
  GlobalStateQuery,
  GlobalStateResponse,
  GlobalStateSessionSummary,
} from "@/lib/global-state-types";

function hasValidWatermarkChunks(doc: SessionDocument): boolean {
  if (doc.status !== "watermarked") return false;
  const chunks = doc.chunks_json;
  if (!chunks || chunks.length === 0) return false;

  const markdown = (doc.user_markdown ?? doc.parsed_markdown ?? "") as string;
  let expectedCorpusId: string;
  try {
    expectedCorpusId = parseCorpusContent(markdown).corpus_id;
  } catch {
    return false;
  }

  return chunks.every((chunk) => {
    const verification = verifyChunkWatermark(chunk.content);
    if (!verification.valid || !verification.payload) return false;
    if (verification.payload.corpusId !== expectedCorpusId) return false;
    if (verification.payload.sequence !== chunk.sequence) return false;
    return true;
  });
}

function deriveStage(
  doc: SessionDocument,
  session: CorpusSession,
): GlobalStateDocumentRow["stage"] {
  if (doc.status === "failed") return "failed";
  if (doc.status === "pending" || doc.status === "parsing") return "parse";
  if (doc.status === "parsed" || doc.status === "edited") return "chunk";
  if (doc.status === "chunked") return "watermark";
  if (doc.status === "watermarked" && !doc.promoted_at) return "promote";
  if (doc.status === "watermarked" && doc.promoted_at && !session.crosswalk_markdown) {
    return "crosswalk";
  }
  return "ready";
}

function deriveStaleness(doc: SessionDocument, nowMs: number): { isStale: boolean; staleHours: number } {
  const updatedMs = Date.parse(doc.updated_at);
  if (!Number.isFinite(updatedMs)) return { isStale: false, staleHours: 0 };

  const hoursSinceUpdate = (nowMs - updatedMs) / (1000 * 60 * 60);

  if (doc.status === "parsing" || doc.status === "pending") {
    return { isStale: hoursSinceUpdate >= 1, staleHours: Math.max(0, Math.floor(hoursSinceUpdate)) };
  }

  if (
    doc.status === "parsed" ||
    doc.status === "edited" ||
    doc.status === "chunked" ||
    (doc.status === "watermarked" && !doc.promoted_at)
  ) {
    return { isStale: hoursSinceUpdate >= 24, staleHours: Math.max(0, Math.floor(hoursSinceUpdate)) };
  }

  return { isStale: false, staleHours: 0 };
}

function deriveAttentionReason(
  doc: SessionDocument,
  stage: GlobalStateDocumentRow["stage"],
  isStale: boolean,
  staleHours: number,
): string | null {
  if (doc.status === "failed") {
    return doc.error_message?.trim() || "Processing failed";
  }

  if (!isStale) return null;

  if (stage === "parse") {
    return `Parsing appears stalled (${String(staleHours)}h since update)`;
  }
  if (stage === "chunk") {
    return `Needs chunking (${String(staleHours)}h pending)`;
  }
  if (stage === "watermark") {
    return `Needs watermarking (${String(staleHours)}h pending)`;
  }
  if (stage === "promote") {
    return `Watermarked but not promoted (${String(staleHours)}h pending)`;
  }

  return null;
}

function deriveNextAction(stage: GlobalStateDocumentRow["stage"], status: SessionDocumentStatus): string {
  if (status === "failed") return "Re-parse document";
  if (stage === "parse") return "Wait for parse or retry";
  if (stage === "chunk") return "Run chunking";
  if (stage === "watermark") return "Run watermark";
  if (stage === "promote") return "Promote to Encyclopedia";
  if (stage === "crosswalk") return "Generate crosswalk";
  return "Ready";
}

function safeExtractMetadata(markdown: string | null): { title: string | null; frameworks: string[] } {
  if (!markdown?.trim()) return { title: null, frameworks: [] };
  try {
    const parsed = parseCorpusContent(markdown);
    return {
      title: parsed.title ?? null,
      frameworks: parsed.frameworks ?? [],
    };
  } catch {
    return { title: null, frameworks: [] };
  }
}

function normalizeQueryInput(data: GlobalStateQuery | undefined): Required<GlobalStateQuery> {
  const page = Number.isFinite(data?.page) ? Math.max(1, Math.floor(data?.page ?? 1)) : 1;
  const requestedPageSize = Number.isFinite(data?.pageSize)
    ? Math.floor(data?.pageSize ?? 50)
    : 50;
  const pageSize = Math.min(200, Math.max(10, requestedPageSize));

  return {
    query: data?.query?.trim() ?? "",
    sessionId: data?.sessionId?.trim() ?? "all",
    stage: data?.stage ?? "all",
    framework: data?.framework?.trim() ?? "all",
    preset: data?.preset ?? "all",
    sortKey: data?.sortKey ?? "updatedAt",
    sortDirection: data?.sortDirection ?? "desc",
    page,
    pageSize,
  };
}

function includesNormalizedText(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function applyGlobalFilters(rows: GlobalStateDocumentRow[], query: Required<GlobalStateQuery>) {
  const filtered = rows.filter((row) => {
    const presetMatch =
      query.preset === "all"
        ? true
        : query.preset === "attention"
          ? Boolean(row.attentionReason)
          : query.preset === "in-progress"
            ? row.stage === "parse" || row.stage === "chunk" || row.stage === "watermark"
            : query.preset === "ready"
              ? row.stage === "ready" || row.stage === "crosswalk"
              : row.status === "failed";

    const textMatch =
      includesNormalizedText(row.sourceFilename, query.query) ||
      includesNormalizedText(row.sourceHash, query.query) ||
      includesNormalizedText(row.sessionName, query.query) ||
      includesNormalizedText(row.title ?? "", query.query) ||
      row.frameworks.some((framework) => includesNormalizedText(framework, query.query));

    const sessionMatch = query.sessionId === "all" || row.sessionId === query.sessionId;
    const stageMatch = query.stage === "all" || row.stage === query.stage;
    const frameworkMatch = query.framework === "all" || row.frameworks.includes(query.framework);

    return presetMatch && textMatch && sessionMatch && stageMatch && frameworkMatch;
  });

  const sorted = [...filtered].sort((a, b) => {
    let left: string | number;
    let right: string | number;

    if (query.sortKey === "updatedAt") {
      left = Date.parse(a.updatedAt);
      right = Date.parse(b.updatedAt);
    } else if (query.sortKey === "sessionName") {
      left = a.sessionName;
      right = b.sessionName;
    } else if (query.sortKey === "stage") {
      left = a.stage;
      right = b.stage;
    } else {
      left = a.status;
      right = b.status;
    }

    if (left < right) return query.sortDirection === "asc" ? -1 : 1;
    if (left > right) return query.sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.pageSize;
  const paged = sorted.slice(offset, offset + query.pageSize);

  return {
    filtered: sorted,
    paged,
    pagination: {
      page,
      pageSize: query.pageSize,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  };
}

export async function loadGlobalDocumentState(params: {
  service: SupabaseClient;
  userId: string;
  query?: GlobalStateQuery;
}): Promise<GlobalStateResponse> {
  const query = normalizeQueryInput(params.query);

  const sessions = (await listSessionsFn(params.service)).filter((session) => session.created_by === params.userId);
  const sessionIds = sessions.map((session) => session.id);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  if (sessionIds.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalDocuments: 0,
        attention: 0,
        inProgress: 0,
        ready: 0,
        failed: 0,
        stale: 0,
      },
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false,
      },
      sessions: [],
      documents: [],
    };
  }

  const { data: documentsRaw, error: documentsError } = await params.service
    .from("corpus_session_documents")
    .select("*")
    .in("session_id", sessionIds)
    .order("updated_at", { ascending: false });

  if (documentsError) {
    throw new Error(`Failed to load global document state: ${documentsError.message}`);
  }

  const documents = (documentsRaw ?? []) as SessionDocument[];
  const nowMs = Date.now();

  const rows = documents
    .map((doc): GlobalStateDocumentRow | null => {
      const session = sessionById.get(doc.session_id);
      if (!session) return null;

      const stage = deriveStage(doc, session);
      const watermarkValid = hasValidWatermarkChunks(doc);
      const markdown = (doc.user_markdown ?? doc.parsed_markdown) as string | null;
      const metadata = safeExtractMetadata(markdown);
      const chunkCount = doc.chunks_json?.length ?? 0;
      const { isStale, staleHours } = deriveStaleness(doc, nowMs);
      const attentionReason = deriveAttentionReason(doc, stage, isStale, staleHours);

      return {
        documentId: doc.id,
        sessionId: doc.session_id,
        sessionName: session.name,
        sessionStatus: session.status,
        sourceFilename: doc.source_filename,
        sourceHash: doc.source_hash,
        status: doc.status,
        stage,
        title: metadata.title,
        frameworks: metadata.frameworks,
        chunkCount,
        promoted: Boolean(doc.promoted_at),
        watermarkValid,
        updatedAt: doc.updated_at,
        stale: isStale,
        attentionReason,
        nextAction: deriveNextAction(stage, doc.status),
        errorMessage: doc.error_message,
      };
    })
    .filter((row): row is GlobalStateDocumentRow => row !== null);

  const filteredResult = applyGlobalFilters(rows, query);

  const summary = {
    totalDocuments: filteredResult.filtered.length,
    attention: filteredResult.filtered.filter((row) => Boolean(row.attentionReason)).length,
    inProgress: filteredResult.filtered.filter(
      (row) => row.stage === "parse" || row.stage === "chunk" || row.stage === "watermark",
    ).length,
    ready: filteredResult.filtered.filter((row) => row.stage === "ready" || row.stage === "crosswalk").length,
    failed: filteredResult.filtered.filter((row) => row.status === "failed").length,
    stale: filteredResult.filtered.filter((row) => row.stale).length,
  };

  const sessionsSummary: GlobalStateSessionSummary[] = sessions
    .map((session) => {
      const sessionRows = filteredResult.filtered.filter((row) => row.sessionId === session.id);
      return {
        id: session.id,
        name: session.name,
        status: session.status,
        updatedAt: session.updated_at,
        documentCount: sessionRows.length,
        attentionCount: sessionRows.filter((row) => Boolean(row.attentionReason)).length,
        inProgressCount: sessionRows.filter(
          (row) => row.stage === "parse" || row.stage === "chunk" || row.stage === "watermark",
        ).length,
      };
    })
    .sort((a, b) => b.attentionCount - a.attentionCount || b.inProgressCount - a.inProgressCount);

  return {
    generatedAt: new Date().toISOString(),
    summary,
    pagination: filteredResult.pagination,
    sessions: sessionsSummary,
    documents: filteredResult.paged,
  };
}