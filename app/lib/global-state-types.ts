export type GlobalStateStage =
  | "all"
  | "failed"
  | "parse"
  | "chunk"
  | "watermark"
  | "promote"
  | "crosswalk"
  | "ready";

export type GlobalStatePreset = "attention" | "all" | "in-progress" | "ready" | "failed";

export type GlobalStateSortKey = "updatedAt" | "sessionName" | "stage" | "status";

export type GlobalStateSortDirection = "asc" | "desc";

export type GlobalStateQuery = {
  query?: string;
  sessionId?: string;
  stage?: GlobalStateStage;
  framework?: string;
  preset?: GlobalStatePreset;
  sortKey?: GlobalStateSortKey;
  sortDirection?: GlobalStateSortDirection;
  page?: number;
  pageSize?: number;
};

export type GlobalStateSessionStatus =
  | "uploading"
  | "complete"
  | "crosswalk_pending"
  | "crosswalk_done"
  | "archived";

export type GlobalStateDocumentStatus =
  | "pending"
  | "parsing"
  | "parsed"
  | "edited"
  | "failed"
  | "chunked"
  | "watermarked";

export type GlobalStateRowStage = Exclude<GlobalStateStage, "all">;

export type GlobalStateDocumentRow = {
  documentId: string;
  sessionId: string;
  sessionName: string;
  sessionStatus: GlobalStateSessionStatus;
  sourceFilename: string;
  sourceHash: string;
  status: GlobalStateDocumentStatus;
  stage: GlobalStateRowStage;
  title: string | null;
  frameworks: string[];
  chunkCount: number;
  promoted: boolean;
  watermarkValid: boolean;
  auditWarningCount: number;
  auditWarningPreview: string[];
  parseJob: {
    id: number;
    status: "pending" | "in_progress" | "done" | "failed";
    retryCount: number;
    maxRetries: number;
    updatedAt: string;
    error: string | null;
    step: string | null;
    message: string | null;
  } | null;
  updatedAt: string;
  stale: boolean;
  attentionReason: string | null;
  nextAction: string;
  errorMessage: string | null;
};

export type GlobalStateSessionSummary = {
  id: string;
  name: string;
  status: GlobalStateSessionStatus;
  updatedAt: string;
  documentCount: number;
  attentionCount: number;
  inProgressCount: number;
};

export type GlobalStateResponse = {
  generatedAt: string;
  summary: {
    totalDocuments: number;
    attention: number;
    inProgress: number;
    ready: number;
    failed: number;
    stale: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  sessions: GlobalStateSessionSummary[];
  documents: GlobalStateDocumentRow[];
};

export type ServerErrorCode =
  | "AUTH_UNAUTHENTICATED"
  | "AUTH_FORBIDDEN"
  | "RESOURCE_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "DEPENDENCY_ERROR"
  | "UNKNOWN_ERROR";

export type ServerErrorEnvelope = {
  code: ServerErrorCode;
  message: string;
  status: number;
};

export type ServerResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: ServerErrorEnvelope;
    };

export type GlobalStateActionKind = "parse" | "chunk" | "watermark" | "stop_parse";

export type GlobalStateActionRequest = {
  documentId: string;
  action: GlobalStateActionKind;
  parsePromptProfile?: "published_standard" | "interpretation";
};

export type GlobalStateActionResponse = {
  documentId: string;
  action: GlobalStateActionKind;
  status: "started" | "completed";
  jobId?: number;
  model?: string;
  chunkCount?: number;
};