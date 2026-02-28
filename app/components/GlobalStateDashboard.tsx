import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type {
  GlobalStateDocumentRow,
  GlobalStateQuery,
  GlobalStateResponse,
  GlobalStateSessionSummary,
} from "@/lib/global-state-types";
import { useGlobalStateOps } from "@/lib/use-global-state-ops";

type DashboardRow = GlobalStateDocumentRow;
type DashboardSession = GlobalStateSessionSummary;

type ViewPreset = "attention" | "all" | "in-progress" | "ready" | "failed";
type SortKey = "updatedAt" | "sessionName" | "stage" | "status";
type SortDirection = "asc" | "desc";
type RowAction = "parse" | "chunk" | "watermark";
type RefreshIntervalSeconds = 0 | 15 | 30 | 60;
type ColumnKey = "session" | "stage" | "status" | "blocker" | "updated" | "action";

interface ToastMessage {
  id: string;
  kind: "success" | "error";
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface SavedView {
  id: string;
  name: string;
  preset: ViewPreset;
  query: string;
  sessionId: string;
  stage: NonNullable<GlobalStateQuery["stage"]>;
  framework: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  pageSize: number;
  visibleColumns: Record<ColumnKey, boolean>;
}

interface OpsPreferenceState {
  refreshIntervalSeconds: RefreshIntervalSeconds;
  pageSize: number;
  visibleColumns: Record<ColumnKey, boolean>;
  showAdvancedControls?: boolean;
}

interface ActionLogEntry {
  id: string;
  timestamp: string;
  action: RowAction;
  documentId: string;
  sourceFilename: string;
  ok: boolean;
  durationMs: number;
  message: string;
}

const STORAGE_VIEWS_KEY = "global-state.saved-views.v1";
const STORAGE_PREFS_KEY = "global-state.ops-prefs.v1";
const STORAGE_OPERATOR_MODE_KEY = "global-state.operator-mode.v1";
const STORAGE_ACTION_LOG_KEY = "global-state.action-log.v1";

const DEFAULT_VISIBLE_COLUMNS: Record<ColumnKey, boolean> = {
  session: true,
  stage: true,
  status: true,
  blocker: true,
  updated: true,
  action: true,
};

const stageLabels: Record<DashboardRow["stage"], string> = {
  failed: "Failed",
  parse: "Parse",
  chunk: "Chunk",
  watermark: "Watermark",
  promote: "Promote",
  crosswalk: "Crosswalk",
  ready: "Ready",
};

const statusColors: Record<string, string> = {
  failed: "bg-error/10 text-error",
  parsing: "bg-corpus-100 text-corpus-700",
  pending: "bg-corpus-100 text-corpus-700",
  parsed: "bg-amber-100 text-amber-700",
  edited: "bg-amber-100 text-amber-700",
  chunked: "bg-blue-100 text-blue-700",
  watermarked: "bg-green-100 text-green-700",
};

const sessionStatusColors: Record<string, string> = {
  uploading: "bg-corpus-100 text-corpus-700",
  complete: "bg-green-100 text-green-700",
  crosswalk_pending: "bg-amber-100 text-amber-700",
  crosswalk_done: "bg-green-100 text-green-700",
  archived: "bg-surface-alt text-text-muted",
};

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionForRow(row: DashboardRow): RowAction | null {
  if (row.status === "failed" || row.stage === "parse") return "parse";
  if (row.stage === "chunk") return "chunk";
  if (row.stage === "watermark") return "watermark";
  return null;
}

function actionLabel(action: RowAction, busy: boolean): string {
  if (!busy) {
    if (action === "parse") return "Retry parse";
    if (action === "chunk") return "Run chunk";
    return "Run watermark";
  }
  if (action === "parse") return "Parsing...";
  if (action === "chunk") return "Chunking...";
  return "Watermarking...";
}

function SummaryCard({
  label,
  value,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-4 text-left transition-colors ${
        selected
          ? "border-corpus-500 bg-corpus-50"
          : "border-border bg-surface hover:bg-surface-alt"
      }`}
    >
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-text">{String(value)}</p>
    </button>
  );
}

function makeToast(
  kind: ToastMessage["kind"],
  text: string,
  options?: Pick<ToastMessage, "actionLabel" | "onAction">,
): ToastMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    text,
    actionLabel: options?.actionLabel,
    onAction: options?.onAction,
  };
}

export function GlobalStateDashboard({
  data,
  initialQuery,
}: {
  data: GlobalStateResponse;
  initialQuery?: Partial<GlobalStateQuery>;
}) {
  const { refresh, runAction } = useGlobalStateOps();

  const [rows, setRows] = useState<DashboardRow[]>(data.documents);
  const [sessions, setSessions] = useState<DashboardSession[]>(data.sessions);
  const [generatedAt, setGeneratedAt] = useState(data.generatedAt);
  const [summary, setSummary] = useState(data.summary);
  const [pagination, setPagination] = useState(data.pagination);

  const [preset, setPreset] = useState<ViewPreset>(
    initialQuery?.preset ?? (data.summary.attention > 0 ? "attention" : "all"),
  );
  const [query, setQuery] = useState(initialQuery?.query ?? "");
  const [sessionId, setSessionId] = useState(initialQuery?.sessionId ?? "all");
  const [stage, setStage] = useState(initialQuery?.stage ?? "all");
  const [framework, setFramework] = useState(initialQuery?.framework ?? "all");
  const [sortKey, setSortKey] = useState<SortKey>(initialQuery?.sortKey ?? "updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    initialQuery?.sortDirection ?? "desc",
  );

  const [loadingByDocument, setLoadingByDocument] = useState<Record<string, RowAction | null>>({});
  const [bulkAction, setBulkAction] = useState<RowAction | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());
  const [selectAcrossPages, setSelectAcrossPages] = useState(false);
  const [focusedDocumentId, setFocusedDocumentId] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState<RefreshIntervalSeconds>(30);
  const [pageSize, setPageSize] = useState(initialQuery?.pageSize ?? data.pagination.pageSize);
  const [page, setPage] = useState(initialQuery?.page ?? data.pagination.page);

  const [operatorMode, setOperatorMode] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [showColumnControls, setShowColumnControls] = useState(false);
  const [showActionLog, setShowActionLog] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(DEFAULT_VISIBLE_COLUMNS);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("");

  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const skipInitialAutoRefresh = useRef(true);

  const serverQuery = useMemo(
    () => ({
      query,
      sessionId,
      stage,
      framework,
      preset,
      sortKey,
      sortDirection,
      page,
      pageSize,
    }),
    [framework, page, pageSize, preset, query, sessionId, sortDirection, sortKey, stage],
  );

  const pushToast = (
    kind: ToastMessage["kind"],
    text: string,
    options?: Pick<ToastMessage, "actionLabel" | "onAction">,
  ) => {
    const toast = makeToast(kind, text, options);
    setToasts((current) => [...current, toast]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toast.id));
    }, 3800);
  };

  const appendActionLog = (entry: Omit<ActionLogEntry, "id">) => {
    const logEntry: ActionLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...entry,
    };
    setActionLog((current) => {
      const next = [logEntry, ...current].slice(0, 200);
      return next;
    });
  };

  useEffect(() => {
    try {
      const rawPrefs = localStorage.getItem(STORAGE_PREFS_KEY);
      if (rawPrefs) {
        const parsed = JSON.parse(rawPrefs) as OpsPreferenceState;
        setRefreshIntervalSeconds(parsed.refreshIntervalSeconds ?? 30);
        setPageSize(parsed.pageSize ?? 50);
        setVisibleColumns(parsed.visibleColumns ?? DEFAULT_VISIBLE_COLUMNS);
        setShowAdvancedControls(parsed.showAdvancedControls ?? false);
      }
    } catch {
      // ignore invalid local storage payload
    }

    try {
      const rawViews = localStorage.getItem(STORAGE_VIEWS_KEY);
      if (rawViews) {
        const parsed = JSON.parse(rawViews) as SavedView[];
        setSavedViews(parsed);
      }
    } catch {
      // ignore invalid local storage payload
    }

    try {
      const rawOperator = localStorage.getItem(STORAGE_OPERATOR_MODE_KEY);
      if (rawOperator) {
        setOperatorMode(rawOperator === "true");
      }
    } catch {
      // ignore invalid local storage payload
    }

    try {
      const rawActionLog = localStorage.getItem(STORAGE_ACTION_LOG_KEY);
      if (rawActionLog) {
        const parsed = JSON.parse(rawActionLog) as ActionLogEntry[];
        setActionLog(parsed.slice(0, 200));
      }
    } catch {
      // ignore invalid local storage payload
    }
  }, []);

  useEffect(() => {
    const prefs: OpsPreferenceState = {
      refreshIntervalSeconds,
      pageSize,
      visibleColumns,
      showAdvancedControls,
    };
    localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(prefs));
  }, [refreshIntervalSeconds, pageSize, visibleColumns, showAdvancedControls]);

  useEffect(() => {
    localStorage.setItem(STORAGE_VIEWS_KEY, JSON.stringify(savedViews));
  }, [savedViews]);

  useEffect(() => {
    localStorage.setItem(STORAGE_OPERATOR_MODE_KEY, operatorMode ? "true" : "false");
  }, [operatorMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_ACTION_LOG_KEY, JSON.stringify(actionLog));
  }, [actionLog]);

  const availableFrameworks = useMemo(
    () =>
      Array.from(new Set(rows.flatMap((doc) => doc.frameworks))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  );

  const totalPages = pagination.totalPages;
  const pageStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize;
  const pagedRows = rows;

  useEffect(() => {
    if (pagedRows.length === 0) {
      setFocusedDocumentId(null);
      return;
    }
    if (!focusedDocumentId || !pagedRows.some((row) => row.documentId === focusedDocumentId)) {
      setFocusedDocumentId(pagedRows[0].documentId);
    }
  }, [pagedRows, focusedDocumentId]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedDocumentIds.has(row.documentId)),
    [rows, selectedDocumentIds],
  );

  const selectedParseRows = useMemo(
    () => selectedRows.filter((row) => actionForRow(row) === "parse"),
    [selectedRows],
  );

  const selectedChunkRows = useMemo(
    () => selectedRows.filter((row) => actionForRow(row) === "chunk"),
    [selectedRows],
  );

  const selectedWatermarkRows = useMemo(
    () => selectedRows.filter((row) => actionForRow(row) === "watermark"),
    [selectedRows],
  );

  const hasBulkSelection = selectAcrossPages || selectedRows.length > 0;

  const workflowCounts = useMemo(() => {
    const parseReady = rows.filter((row) => actionForRow(row) === "parse").length;
    const chunkReady = rows.filter((row) => actionForRow(row) === "chunk").length;
    const watermarkReady = rows.filter((row) => actionForRow(row) === "watermark").length;
    const complete = rows.filter((row) => row.status === "watermarked").length;
    return {
      parseReady,
      chunkReady,
      watermarkReady,
      complete,
    };
  }, [rows]);

  const quickFilterCounts = useMemo(() => {
    const needsParse = rows.filter((row) => actionForRow(row) === "parse").length;
    const needsChunk = rows.filter((row) => actionForRow(row) === "chunk").length;
    const needsWatermark = rows.filter((row) => actionForRow(row) === "watermark").length;
    const failed = rows.filter((row) => row.status === "failed").length;
    return { needsParse, needsChunk, needsWatermark, failed };
  }, [rows]);

  const allPagedSelected =
    pagedRows.length > 0 && pagedRows.every((row) => selectedDocumentIds.has(row.documentId));

  function updateRowsAfterActionSuccess(row: DashboardRow, action: RowAction, nowIso: string) {
    setRows((current) =>
      current.map((item) => {
        if (item.documentId !== row.documentId) return item;

        if (action === "parse") {
          return {
            ...item,
            status: "parsing",
            stage: "parse",
            stale: false,
            attentionReason: null,
            errorMessage: null,
            nextAction: "Wait for parse or retry",
            updatedAt: nowIso,
          };
        }

        if (action === "chunk") {
          return {
            ...item,
            status: "chunked",
            stage: "watermark",
            stale: false,
            attentionReason: null,
            nextAction: "Run watermark",
            updatedAt: nowIso,
          };
        }

        return {
          ...item,
          status: "watermarked",
          stage: item.promoted ? "crosswalk" : "promote",
          watermarkValid: true,
          stale: false,
          attentionReason: null,
          nextAction: item.promoted ? "Generate crosswalk" : "Promote to Encyclopedia",
          updatedAt: nowIso,
        };
      }),
    );
  }

  async function refreshStateFromServer() {
    const fresh = await refresh(serverQuery);
    setRows(fresh.documents);
    setSessions(fresh.sessions);
    setGeneratedAt(fresh.generatedAt);
    setSummary(fresh.summary);
    setPagination(fresh.pagination);
    setPage(fresh.pagination.page);
    setSelectedDocumentIds((current) => {
      const validIds = new Set(fresh.documents.map((row) => row.documentId));
      const next = new Set<string>();
      current.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }

  async function refreshWithSpinner() {
    setRefreshing(true);
    try {
      await refreshStateFromServer();
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (refreshIntervalSeconds === 0) return;
    const interval = setInterval(() => {
      void refreshStateFromServer();
    }, refreshIntervalSeconds * 1000);
    return () => clearInterval(interval);
  }, [refreshIntervalSeconds]);

  useEffect(() => {
    if (skipInitialAutoRefresh.current) {
      skipInitialAutoRefresh.current = false;
      return;
    }
    void refreshStateFromServer();
  }, [serverQuery]);

  async function executeRowAction(row: DashboardRow, action: RowAction): Promise<boolean> {
    const started = performance.now();
    const nowIso = new Date().toISOString();

    if (action === "parse") {
      setRows((current) =>
        current.map((item) =>
          item.documentId === row.documentId
            ? {
                ...item,
                status: "parsing",
                stage: "parse",
                stale: false,
                attentionReason: null,
                errorMessage: null,
                nextAction: "Wait for parse or retry",
                updatedAt: nowIso,
              }
            : item,
        ),
      );
    }

    try {
      if (action === "parse") {
        await runAction({
          documentId: row.documentId,
          action: "parse",
          parsePromptProfile: "published_standard",
        });
      }
      if (action === "chunk") {
        await runAction({ documentId: row.documentId, action: "chunk" });
      }
      if (action === "watermark") {
        await runAction({ documentId: row.documentId, action: "watermark" });
      }

      updateRowsAfterActionSuccess(row, action, nowIso);

      const durationMs = Math.round(performance.now() - started);
      const successMessage =
        action === "parse"
          ? `${row.sourceFilename}: parse queued. Next: open session and review parsed output.`
          : action === "chunk"
            ? `${row.sourceFilename}: chunking complete. Next: run watermark to lock provenance.`
            : `${row.sourceFilename}: watermark complete. Next: promote or continue toward crosswalk.`;
      pushToast("success", successMessage);
      appendActionLog({
        timestamp: new Date().toISOString(),
        action,
        documentId: row.documentId,
        sourceFilename: row.sourceFilename,
        ok: true,
        durationMs,
        message: successMessage,
      });
      console.info("[global-ops-action]", {
        action,
        documentId: row.documentId,
        ok: true,
        durationMs,
      });
      return true;
    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      const message = error instanceof Error ? error.message : String(error);
      const errorMessage = `${row.sourceFilename}: ${message}`;
      pushToast("error", errorMessage);
      appendActionLog({
        timestamp: new Date().toISOString(),
        action,
        documentId: row.documentId,
        sourceFilename: row.sourceFilename,
        ok: false,
        durationMs,
        message,
      });
      console.error("[global-ops-action]", {
        action,
        documentId: row.documentId,
        ok: false,
        durationMs,
        error: message,
      });
      return false;
    }
  }

  async function runRowAction(row: DashboardRow) {
    const action = actionForRow(row);
    if (!action || !operatorMode) return;

    setLoadingByDocument((current) => ({ ...current, [row.documentId]: action }));
    try {
      await executeRowAction(row, action);
      await refreshStateFromServer();
    } finally {
      setLoadingByDocument((current) => ({ ...current, [row.documentId]: null }));
    }
  }

  async function runBulkAction(action: RowAction) {
    if (!operatorMode) {
      pushToast("error", "Enable Operator Mode to run write actions");
      return;
    }

    let targets =
      action === "parse"
        ? selectedParseRows
        : action === "chunk"
          ? selectedChunkRows
          : selectedWatermarkRows;

    if (selectAcrossPages) {
      const firstPage = await refresh({
        ...serverQuery,
        page: 1,
        pageSize: 200,
      });

      const allRows = [...firstPage.documents];
      for (let pageIndex = 2; pageIndex <= firstPage.pagination.totalPages; pageIndex += 1) {
        const pageData = await refresh({
          ...serverQuery,
          page: pageIndex,
          pageSize: 200,
        });
        allRows.push(...pageData.documents);
      }

      const uniqueRows = Array.from(
        new Map(allRows.map((row) => [row.documentId, row])).values(),
      );

      targets = uniqueRows.filter((row) => actionForRow(row) === action);
    }

    if (targets.length === 0) {
      pushToast("error", `No selected rows are eligible for ${actionLabel(action, false).toLowerCase()}`);
      return;
    }

    const confirmed = window.confirm(
      `Run ${actionLabel(action, false)} for ${String(targets.length)} ${selectAcrossPages ? "filtered" : "selected"} document${targets.length === 1 ? "" : "s"}?`,
    );
    if (!confirmed) return;

    setBulkAction(action);
    setLoadingByDocument((current) => {
      const next = { ...current };
      targets.forEach((row) => {
        next[row.documentId] = action;
      });
      return next;
    });

    let successCount = 0;
    let failureCount = 0;

    for (const row of targets) {
      const ok = await executeRowAction(row, action);
      if (ok) successCount += 1;
      else failureCount += 1;
    }

    await refreshStateFromServer();

    setLoadingByDocument((current) => {
      const next = { ...current };
      targets.forEach((row) => {
        next[row.documentId] = null;
      });
      return next;
    });

    const priorSelection = new Set(selectedDocumentIds);
    const priorSelectAcrossPages = selectAcrossPages;

    setBulkAction(null);
    setSelectAcrossPages(false);
    setSelectedDocumentIds(new Set());

    const summaryMessage =
      action === "parse"
        ? `Bulk parse complete: ${String(successCount)} succeeded, ${String(failureCount)} failed. Next: review parsed outputs.`
        : action === "chunk"
          ? `Bulk chunk complete: ${String(successCount)} succeeded, ${String(failureCount)} failed. Next: run watermark.`
          : `Bulk watermark complete: ${String(successCount)} succeeded, ${String(failureCount)} failed. Next: promote and generate crosswalk.`;
    pushToast(failureCount === 0 ? "success" : "error", summaryMessage, {
      actionLabel: "Undo selection",
      onAction: () => {
        setSelectAcrossPages(priorSelectAcrossPages);
        setSelectedDocumentIds(priorSelection);
      },
    });
  }

  function changeSort(next: SortKey) {
    if (sortKey === next) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(next);
    setSortDirection(next === "updatedAt" ? "desc" : "asc");
  }

  function resetFilters() {
    setPreset("all");
    setQuery("");
    setSessionId("all");
    setStage("all");
    setFramework("all");
    setPage(1);
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  function toggleRowSelected(documentId: string) {
    if (selectAcrossPages) {
      setSelectAcrossPages(false);
    }
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function toggleSelectAllPaged() {
    const pagedIds = pagedRows.map((row) => row.documentId);
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (allPagedSelected) {
        pagedIds.forEach((id) => next.delete(id));
      } else {
        pagedIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function updateColumnVisibility(key: ColumnKey, enabled: boolean) {
    setVisibleColumns((current) => ({ ...current, [key]: enabled }));
  }

  function saveCurrentView() {
    const name = window.prompt("Saved view name");
    if (!name?.trim()) return;

    const view: SavedView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      preset,
      query,
      sessionId,
      stage,
      framework,
      sortKey,
      sortDirection,
      pageSize,
      visibleColumns,
    };

    setSavedViews((current) => [view, ...current].slice(0, 30));
    setSelectedViewId(view.id);
    pushToast("success", `Saved view: ${view.name}`);
  }

  function applyView(viewId: string) {
    const view = savedViews.find((item) => item.id === viewId);
    if (!view) return;

    setSelectedViewId(view.id);
    setPreset(view.preset);
    setQuery(view.query);
    setSessionId(view.sessionId);
    setStage(view.stage);
    setFramework(view.framework);
    setSortKey(view.sortKey);
    setSortDirection(view.sortDirection);
    setPageSize(view.pageSize);
    setVisibleColumns(view.visibleColumns);
    setPage(1);

    pushToast("success", `Applied view: ${view.name}`);
  }

  function deleteView(viewId: string) {
    const view = savedViews.find((item) => item.id === viewId);
    if (!view) return;

    const confirmed = window.confirm(`Delete saved view "${view.name}"?`);
    if (!confirmed) return;

    setSavedViews((current) => current.filter((item) => item.id !== viewId));
    if (selectedViewId === viewId) setSelectedViewId("");
  }

  function exportFailuresCsv() {
    const candidateRows =
      selectedRows.length > 0
        ? selectedRows.filter((row) => row.status === "failed" || Boolean(row.attentionReason))
        : rows.filter((row) => row.status === "failed" || Boolean(row.attentionReason));

    if (candidateRows.length === 0) {
      pushToast("error", "No failed/attention rows to export");
      return;
    }

    const headers = [
      "documentId",
      "sessionId",
      "sessionName",
      "sourceFilename",
      "sourceHash",
      "stage",
      "status",
      "attentionReason",
      "errorMessage",
      "updatedAt",
      "nextAction",
    ];

    const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;

    const lines = [headers.join(",")];
    candidateRows.forEach((row) => {
      lines.push(
        [
          row.documentId,
          row.sessionId,
          row.sessionName,
          row.sourceFilename,
          row.sourceHash,
          row.stage,
          row.status,
          row.attentionReason ?? "",
          row.errorMessage ?? "",
          row.updatedAt,
          row.nextAction,
        ]
          .map(csvEscape)
          .join(","),
      );
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `global-state-failures-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);

    pushToast("success", `Exported ${String(candidateRows.length)} failure row${candidateRows.length === 1 ? "" : "s"}`);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (pagedRows.length === 0) return;

      const currentIndex = focusedDocumentId
        ? pagedRows.findIndex((row) => row.documentId === focusedDocumentId)
        : -1;

      if (event.key === "j") {
        event.preventDefault();
        const nextIndex = Math.min(pagedRows.length - 1, currentIndex + 1);
        setFocusedDocumentId(pagedRows[nextIndex].documentId);
      }

      if (event.key === "k") {
        event.preventDefault();
        const nextIndex = Math.max(0, currentIndex - 1);
        setFocusedDocumentId(pagedRows[nextIndex].documentId);
      }

      if (["r", "c", "w"].includes(event.key)) {
        event.preventDefault();
        if (!focusedDocumentId) return;
        const focusedRow = pagedRows.find((row) => row.documentId === focusedDocumentId);
        if (!focusedRow) return;

        const desiredAction: RowAction =
          event.key === "r" ? "parse" : event.key === "c" ? "chunk" : "watermark";

        const rowAction = actionForRow(focusedRow);
        if (rowAction !== desiredAction) {
          pushToast("error", `Focused row is not eligible for ${actionLabel(desiredAction, false).toLowerCase()}`);
          return;
        }

        if (!operatorMode) {
          pushToast("error", "Enable Operator Mode to run keyboard actions");
          return;
        }

        if (bulkAction !== null || loadingByDocument[focusedRow.documentId]) return;

        void runRowAction(focusedRow);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    bulkAction,
    focusedDocumentId,
    loadingByDocument,
    operatorMode,
    pagedRows,
    runRowAction,
  ]);

  return (
    <div className="space-y-6">
      {toasts.length > 0 && (
        <div className="fixed right-6 top-6 z-50 space-y-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`max-w-sm rounded-md border px-3 py-2 text-xs shadow-sm ${
                toast.kind === "success"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-error/30 bg-error/10 text-error"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span>{toast.text}</span>
                {toast.actionLabel && toast.onAction && (
                  <button
                    onClick={() => {
                      toast.onAction?.();
                      setToasts((current) => current.filter((item) => item.id !== toast.id));
                    }}
                    className="rounded border border-current/30 px-1.5 py-0.5 text-[11px] font-medium hover:bg-white/60"
                  >
                    {toast.actionLabel}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text">Dashboard</h1>
          <p className="text-xs text-text-muted">
            Unified operational view across all sessions and documents.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-text-muted">Updated {formatUpdated(generatedAt)}</p>
          <select
            value={String(refreshIntervalSeconds)}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10) as RefreshIntervalSeconds;
              setRefreshIntervalSeconds(value);
            }}
            className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text outline-none"
          >
            <option value="0">Auto-refresh: Off</option>
            <option value="15">Auto-refresh: 15s</option>
            <option value="30">Auto-refresh: 30s</option>
            <option value="60">Auto-refresh: 60s</option>
          </select>
          <button
            onClick={() => {
              void refreshWithSpinner();
            }}
            disabled={refreshing}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh now"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard
          label="All"
          value={summary.totalDocuments}
          selected={preset === "all"}
          onClick={() => setPreset("all")}
        />
        <SummaryCard
          label="Attention"
          value={summary.attention}
          selected={preset === "attention"}
          onClick={() => setPreset("attention")}
        />
        <SummaryCard
          label="In Progress"
          value={summary.inProgress}
          selected={preset === "in-progress"}
          onClick={() => setPreset("in-progress")}
        />
        <SummaryCard
          label="Ready"
          value={summary.ready}
          selected={preset === "ready"}
          onClick={() => setPreset("ready")}
        />
        <SummaryCard
          label="Failed"
          value={summary.failed}
          selected={preset === "failed"}
          onClick={() => setPreset("failed")}
        />
        <SummaryCard
          label="Stale"
          value={summary.stale}
          selected={preset === "attention"}
          onClick={() => setPreset("attention")}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-text">Start Here</p>
            <span className="rounded-full bg-corpus-100 px-2 py-0.5 text-[11px] font-medium text-corpus-700">
              Guided path
            </span>
          </div>
          <div className="space-y-2 text-xs text-text-muted">
            <div className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-3 py-2">
              <span>1. Parse documents needing attention</span>
              <button
                onClick={() => {
                  setPreset("attention");
                  setStage("parse");
                  setPage(1);
                }}
                className="rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-text hover:bg-surface"
              >
                View {String(workflowCounts.parseReady)}
              </button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-3 py-2">
              <span>2. Chunk parsed documents</span>
              <button
                onClick={() => {
                  setPreset("all");
                  setStage("chunk");
                  setPage(1);
                }}
                className="rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-text hover:bg-surface"
              >
                View {String(workflowCounts.chunkReady)}
              </button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-3 py-2">
              <span>3. Watermark for export integrity</span>
              <button
                onClick={() => {
                  setPreset("all");
                  setStage("watermark");
                  setPage(1);
                }}
                className="rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-text hover:bg-surface"
              >
                View {String(workflowCounts.watermarkReady)}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="mb-3 text-sm font-semibold text-text">Proof & Trust Signals</p>
          <div className="space-y-2 text-xs text-text-muted">
            <div className="rounded-md border border-border bg-surface-alt px-3 py-2">
              Provenance guarantee: watermark-backed chunk integrity is tracked per document.
            </div>
            <div className="rounded-md border border-border bg-surface-alt px-3 py-2">
              Audit trail: all write actions are captured in the in-browser activity log.
            </div>
            <div className="rounded-md border border-border bg-surface-alt px-3 py-2">
              Export integrity: failures can be exported for review before downstream use.
            </div>
          </div>
          <p className="mt-3 text-[11px] text-text-muted">
            Completed (watermarked): {String(workflowCounts.complete)} of {String(rows.length)} documents.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Filters</p>
          <div className="flex items-center gap-2">
            <p className="text-xs text-text-muted">{String(pagination.total)} results</p>
            <button
              onClick={() => setShowAdvancedControls((current) => !current)}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-alt"
            >
              {showAdvancedControls ? "Hide advanced" : "Show advanced"}
            </button>
            <button
              onClick={resetFilters}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-alt"
            >
              Reset filters
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-6">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search document, hash, title, framework"
            aria-label="Search documents"
            className="rounded-md border border-border bg-white px-3 py-2 text-sm text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500 lg:col-span-2"
          />
          <select
            value={sessionId}
            onChange={(event) => {
              setSessionId(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by session"
            className="rounded-md border border-border bg-white px-3 py-2 text-sm text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
          >
            <option value="all">All sessions</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
          <select
            value={stage}
            onChange={(event) => {
              const nextStage = event.target.value as NonNullable<GlobalStateQuery["stage"]>;
              setStage(nextStage);
              setPage(1);
            }}
            aria-label="Filter by stage"
            className="rounded-md border border-border bg-white px-3 py-2 text-sm text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
          >
            <option value="all">All stages</option>
            <option value="parse">Parse</option>
            <option value="chunk">Chunk</option>
            <option value="watermark">Watermark</option>
            <option value="promote">Promote</option>
            <option value="crosswalk">Crosswalk</option>
            <option value="ready">Ready</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={framework}
            onChange={(event) => {
              setFramework(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by framework"
            className="rounded-md border border-border bg-white px-3 py-2 text-sm text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
          >
            <option value="all">All frameworks</option>
            {availableFrameworks.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={String(pageSize)}
            onChange={(event) => {
              setPageSize(Number.parseInt(event.target.value, 10));
              setPage(1);
            }}
            aria-label="Rows per page"
            className="rounded-md border border-border bg-white px-3 py-2 text-sm text-text outline-none focus:border-corpus-500 focus:ring-1 focus:ring-corpus-500"
          >
            <option value="25">25 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-text-muted">Quick filters:</span>
          <button
            onClick={() => {
              setPreset("attention");
              setStage("parse");
              setPage(1);
            }}
            className="rounded-full border border-border bg-surface-alt px-2.5 py-1 text-xs text-text-muted hover:bg-surface"
          >
            Needs Parse ({String(quickFilterCounts.needsParse)})
          </button>
          <button
            onClick={() => {
              setPreset("all");
              setStage("chunk");
              setPage(1);
            }}
            className="rounded-full border border-border bg-surface-alt px-2.5 py-1 text-xs text-text-muted hover:bg-surface"
          >
            Needs Chunk ({String(quickFilterCounts.needsChunk)})
          </button>
          <button
            onClick={() => {
              setPreset("all");
              setStage("watermark");
              setPage(1);
            }}
            className="rounded-full border border-border bg-surface-alt px-2.5 py-1 text-xs text-text-muted hover:bg-surface"
          >
            Needs Watermark ({String(quickFilterCounts.needsWatermark)})
          </button>
          <button
            onClick={() => {
              setPreset("failed");
              setStage("failed");
              setPage(1);
            }}
            className="rounded-full border border-border bg-surface-alt px-2.5 py-1 text-xs text-text-muted hover:bg-surface"
          >
            Failures ({String(quickFilterCounts.failed)})
          </button>
        </div>

        {pagination.total > pagedRows.length && (
          <label className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-1.5 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={selectAcrossPages}
              onChange={(event) => {
                const enabled = event.target.checked;
                setSelectAcrossPages(enabled);
                if (enabled) {
                  setSelectedDocumentIds(new Set(pagedRows.map((row) => row.documentId)));
                }
              }}
              className="h-4 w-4 rounded border-border"
            />
            Select all filtered results across pages ({String(pagination.total)})
          </label>
        )}

        {showAdvancedControls && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={operatorMode}
                  onChange={(event) => setOperatorMode(event.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Enable write actions
              </label>
              <button
                onClick={saveCurrentView}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
              >
                Save current view
              </button>

              <select
                value={selectedViewId}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedViewId(value);
                  if (value) applyView(value);
                }}
                className="rounded-md border border-border bg-white px-3 py-1.5 text-xs text-text outline-none"
              >
                <option value="">Apply saved view</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>

              {selectedViewId && (
                <button
                  onClick={() => deleteView(selectedViewId)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
                >
                  Delete view
                </button>
              )}

              <button
                onClick={() => setShowColumnControls((current) => !current)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
              >
                {showColumnControls ? "Hide columns" : "Show columns"}
              </button>

              <button
                onClick={exportFailuresCsv}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
              >
                Export issues CSV
              </button>

              <button
                onClick={() => setShowActionLog((current) => !current)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt"
              >
                {showActionLog ? "Hide activity log" : "Show activity log"}
              </button>

              <p className="ml-auto text-[11px] text-text-muted">
                Keyboard shortcuts: J/K move · R parse · C chunk · W watermark
              </p>
            </div>

            {showColumnControls && (
          <div className="mt-3 flex flex-wrap gap-3 rounded-md border border-border bg-surface-alt p-3 text-xs">
            {(
              [
                ["session", "Session"],
                ["stage", "Stage"],
                ["status", "Status"],
                ["blocker", "Blocker"],
                ["updated", "Updated"],
                ["action", "Action"],
              ] as Array<[ColumnKey, string]>
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-text-muted">
                <input
                  type="checkbox"
                  checked={visibleColumns[key]}
                  onChange={(event) => updateColumnVisibility(key, event.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                {label}
              </label>
            ))}
          </div>
            )}
          </div>
        )}
      </div>

      {hasBulkSelection && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-text-muted" title="Bulk actions run only on rows eligible for that stage">
            {selectAcrossPages
              ? `All filtered results selected (${String(pagination.total)})`
              : `${String(selectedRows.length)} selected`}
          </p>
          {selectAcrossPages && (
            <p className="text-[11px] text-text-muted">
              Actions apply across all filtered pages and skip ineligible rows.
            </p>
          )}
          <button
            onClick={() => {
              void runBulkAction("parse");
            }}
            disabled={!operatorMode || bulkAction !== null || (!selectAcrossPages && selectedParseRows.length === 0)}
            title={!operatorMode ? "Enable write actions in Advanced controls" : "Run parse for selected eligible rows"}
            className="rounded-md bg-corpus-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-corpus-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkAction === "parse"
              ? "Parsing..."
              : selectAcrossPages
                ? "Bulk Retry Parse (all pages)"
                : `Bulk Retry Parse (${String(selectedParseRows.length)})`}
          </button>
          <button
            onClick={() => {
              void runBulkAction("chunk");
            }}
            disabled={!operatorMode || bulkAction !== null || (!selectAcrossPages && selectedChunkRows.length === 0)}
            title={!operatorMode ? "Enable write actions in Advanced controls" : "Run chunk for selected eligible rows"}
            className="rounded-md bg-corpus-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-corpus-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkAction === "chunk"
              ? "Chunking..."
              : selectAcrossPages
                ? "Bulk Chunk (all pages)"
                : `Bulk Chunk (${String(selectedChunkRows.length)})`}
          </button>
          <button
            onClick={() => {
              void runBulkAction("watermark");
            }}
            disabled={!operatorMode || bulkAction !== null || (!selectAcrossPages && selectedWatermarkRows.length === 0)}
            title={!operatorMode ? "Enable write actions in Advanced controls" : "Run watermark for selected eligible rows"}
            className="rounded-md bg-corpus-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-corpus-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkAction === "watermark"
              ? "Watermarking..."
              : selectAcrossPages
                ? "Bulk Watermark (all pages)"
                : `Bulk Watermark (${String(selectedWatermarkRows.length)})`}
          </button>
          <button
            onClick={() => {
              setSelectedDocumentIds(new Set());
              setSelectAcrossPages(false);
            }}
            disabled={bulkAction !== null}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear selection
          </button>
        </div>
      )}

      {pagination.total === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <p className="text-sm font-medium text-text">No documents match current filters</p>
          <p className="text-xs text-text-muted">Adjust filters to broaden the view.</p>
        </div>
      ) : (
        <>
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-border bg-surface">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="sticky top-0 z-10 bg-surface-alt">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectAcrossPages || allPagedSelected}
                      onChange={() => {
                        if (selectAcrossPages) {
                          setSelectAcrossPages(false);
                          setSelectedDocumentIds(new Set());
                          return;
                        }
                        toggleSelectAllPaged();
                      }}
                      className="h-4 w-4 rounded border-border"
                      aria-label="Select all visible rows"
                    />
                  </th>
                  <th className="px-4 py-3">Document</th>
                  {visibleColumns.session && <th className="px-4 py-3">Session</th>}
                  {visibleColumns.stage && (
                    <th className="px-4 py-3">
                      <button onClick={() => changeSort("stage")} className="hover:text-text">
                        Stage {sortIndicator("stage")}
                      </button>
                    </th>
                  )}
                  {visibleColumns.status && (
                    <th className="px-4 py-3">
                      <button onClick={() => changeSort("status")} className="hover:text-text">
                        Status {sortIndicator("status")}
                      </button>
                    </th>
                  )}
                  {visibleColumns.blocker && <th className="px-4 py-3">Blocker</th>}
                  {visibleColumns.updated && (
                    <th className="px-4 py-3">
                      <button onClick={() => changeSort("updatedAt")} className="hover:text-text">
                        Updated {sortIndicator("updatedAt")}
                      </button>
                    </th>
                  )}
                  {visibleColumns.action && <th className="px-4 py-3">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedRows.map((row) => {
                  const rowAction = actionForRow(row);
                  const busyAction = loadingByDocument[row.documentId];
                  const isBusy = Boolean(busyAction);
                  const isFocused = focusedDocumentId === row.documentId;

                  return (
                    <tr
                      key={row.documentId}
                      className={`align-top ${isFocused ? "bg-corpus-50/60" : ""}`}
                      onMouseEnter={() => setFocusedDocumentId(row.documentId)}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedDocumentIds.has(row.documentId)}
                          onChange={() => toggleRowSelected(row.documentId)}
                          className="h-4 w-4 rounded border-border"
                          aria-label={`Select ${row.sourceFilename}`}
                        />
                      </td>

                      <td className="px-4 py-3">
                        <p className="font-medium text-text">{row.title ?? row.sourceFilename}</p>
                        <p className="mt-1 text-xs text-text-muted">{row.sourceFilename}</p>
                        <p className="text-xs text-text-muted">hash {row.sourceHash.slice(0, 12)}</p>
                        {row.frameworks.length > 0 && (
                          <p className="mt-1 text-xs text-text-muted">
                            {row.frameworks.slice(0, 3).join(", ")}
                          </p>
                        )}
                      </td>

                      {visibleColumns.session && (
                        <td className="px-4 py-3">
                          <p className="font-medium text-text">{row.sessionName}</p>
                          <span
                            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              sessionStatusColors[row.sessionStatus] ?? "bg-surface-alt text-text-muted"
                            }`}
                          >
                            {row.sessionStatus.replace(/_/g, " ")}
                          </span>
                        </td>
                      )}

                      {visibleColumns.stage && (
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-surface-alt px-2 py-0.5 text-[11px] font-medium text-text">
                            {stageLabels[row.stage]}
                          </span>
                          <p className="mt-1 text-xs text-text-muted">{row.nextAction}</p>
                          <p className="text-xs text-text-muted">
                            {row.chunkCount > 0 ? `${String(row.chunkCount)} chunks` : "No chunks"}
                          </p>
                        </td>
                      )}

                      {visibleColumns.status && (
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              statusColors[row.status] ?? "bg-surface-alt text-text-muted"
                            }`}
                          >
                            {row.status}
                          </span>
                          {row.promoted && <p className="mt-1 text-xs text-green-700">Promoted</p>}
                          {row.status === "watermarked" && (
                            <p className="text-xs text-text-muted">
                              {row.watermarkValid ? "Watermark valid" : "Watermark missing"}
                            </p>
                          )}
                        </td>
                      )}

                      {visibleColumns.blocker && (
                        <td className="px-4 py-3">
                          {row.attentionReason ? (
                            <p className="text-xs text-error">{row.attentionReason}</p>
                          ) : (
                            <p className="text-xs text-text-muted">None</p>
                          )}
                          {row.errorMessage && row.status !== "failed" && (
                            <p className="mt-1 text-xs text-text-muted">{row.errorMessage}</p>
                          )}
                        </td>
                      )}

                      {visibleColumns.updated && (
                        <td className="px-4 py-3 text-xs text-text-muted">
                          {formatUpdated(row.updatedAt)}
                          {row.stale && <p className="mt-1 text-error">Stale</p>}
                        </td>
                      )}

                      {visibleColumns.action && (
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link
                              to="/sessions/$id"
                              params={{ id: row.sessionId }}
                              className="inline-flex whitespace-nowrap rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-alt"
                            >
                              Open session
                            </Link>
                            {rowAction && (
                              <button
                                onClick={() => {
                                  void runRowAction(row);
                                }}
                                disabled={!operatorMode || isBusy || bulkAction !== null}
                                title={!operatorMode ? "Enable write actions in Advanced controls" : undefined}
                                className="inline-flex whitespace-nowrap rounded-md bg-corpus-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-corpus-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {actionLabel(rowAction, isBusy)}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-text-muted">
            <p>
              Showing {String(pageStart === 0 ? 0 : pageStart + 1)}-
              {String(Math.min(pageStart + pagination.pageSize, pagination.total))} of {String(pagination.total)}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="rounded-md border border-border px-2 py-1 hover:bg-surface-alt disabled:opacity-50"
              >
                Prev
              </button>
              <span>
                Page {String(page)} / {String(totalPages)}
              </span>
              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-border px-2 py-1 hover:bg-surface-alt disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {showActionLog && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Operator Action Log</h2>
            <button
              onClick={() => setActionLog([])}
              className="rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-alt"
            >
              Clear log
            </button>
          </div>

          {actionLog.length === 0 ? (
            <p className="text-xs text-text-muted">No actions recorded in this browser yet.</p>
          ) : (
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table className="min-w-full divide-y divide-border text-xs">
                <thead className="bg-surface-alt text-text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-left">Action</th>
                    <th className="px-3 py-2 text-left">Document</th>
                    <th className="px-3 py-2 text-left">Result</th>
                    <th className="px-3 py-2 text-left">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {actionLog.slice(0, 50).map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-3 py-2 text-text-muted">{formatUpdated(entry.timestamp)}</td>
                      <td className="px-3 py-2 text-text">{entry.action}</td>
                      <td className="px-3 py-2 text-text">{entry.sourceFilename}</td>
                      <td className={`px-3 py-2 ${entry.ok ? "text-green-700" : "text-error"}`}>
                        {entry.ok ? "ok" : "failed"}
                      </td>
                      <td className="px-3 py-2 text-text-muted">{String(entry.durationMs)}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
