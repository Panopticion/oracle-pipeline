/**
 * Zustand store for corpus session client state.
 *
 * Hydrated from server-loaded data. Mutations call server functions
 * then optimistically update the store.
 */

import { create } from "zustand";

// ─── Types (mirrored from pipeline for client use) ──────────────────────────

export type SessionStatus =
  | "uploading"
  | "complete"
  | "crosswalk_pending"
  | "crosswalk_done"
  | "archived";

export type DocumentStatus =
  | "pending"
  | "parsing"
  | "parsed"
  | "edited"
  | "failed"
  | "chunked"
  | "watermarked";

export interface ChunkData {
  sequence: number;
  sectionTitle: string;
  headingLevel: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  headingPath: string[];
}

export interface SessionDoc {
  id: string;
  sessionId: string;
  sourceFilename: string;
  sourceHash: string;
  parsedMarkdown: string | null;
  parseModel: string | null;
  parseTokensIn: number | null;
  parseTokensOut: number | null;
  status: DocumentStatus;
  userMarkdown: string | null;
  errorMessage: string | null;
  chunks: ChunkData[] | null;
  sortOrder: number;
}

export type WorkspaceTab = "upload" | "documents" | "crosswalk" | "download";

// ─── Store ──────────────────────────────────────────────────────────────────

interface SessionState {
  // Data
  sessionId: string | null;
  sessionName: string;
  sessionStatus: SessionStatus;
  isPublic: boolean;
  documents: SessionDoc[];
  activeDocumentId: string | null;
  crosswalkMarkdown: string | null;
  currentTab: WorkspaceTab;

  // Actions
  hydrate: (session: {
    id: string;
    name: string;
    status: SessionStatus;
    isPublic: boolean;
    crosswalkMarkdown: string | null;
    documents: SessionDoc[];
  }) => void;
  setTab: (tab: WorkspaceTab) => void;
  setSessionName: (name: string) => void;
  setSessionStatus: (status: SessionStatus) => void;
  setIsPublic: (isPublic: boolean) => void;
  addDocument: (doc: SessionDoc) => void;
  updateDocument: (id: string, updates: Partial<SessionDoc>) => void;
  removeDocument: (id: string) => void;
  setActiveDocument: (id: string | null) => void;
  setCrosswalk: (markdown: string) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null as string | null,
  sessionName: "Untitled Session",
  sessionStatus: "uploading" as SessionStatus,
  isPublic: false,
  documents: [] as SessionDoc[],
  activeDocumentId: null as string | null,
  crosswalkMarkdown: null as string | null,
  currentTab: "upload" as WorkspaceTab,
};

export const useSessionStore = create<SessionState>()((set) => ({
  ...initialState,

  hydrate: (session) =>
    set((state) => {
      // Preserve the current tab if re-entering the same session
      const sameSession = state.sessionId === session.id;
      const defaultTab =
        session.documents.length === 0
          ? "upload"
          : session.status === "crosswalk_done"
            ? "crosswalk"
            : "documents";

      return {
        sessionId: session.id,
        sessionName: session.name,
        sessionStatus: session.status,
        isPublic: session.isPublic,
        crosswalkMarkdown: session.crosswalkMarkdown,
        documents: session.documents,
        currentTab: sameSession ? state.currentTab : defaultTab,
      };
    }),

  setTab: (tab) => set({ currentTab: tab }),

  setSessionName: (name) => set({ sessionName: name }),

  setSessionStatus: (status) => set({ sessionStatus: status }),

  setIsPublic: (isPublic) => set({ isPublic }),

  addDocument: (doc) =>
    set((state) => ({
      documents: [...state.documents, doc],
      currentTab: "documents",
    })),

  updateDocument: (id, updates) =>
    set((state) => ({
      documents: state.documents.map((d) =>
        d.id === id ? { ...d, ...updates } : d,
      ),
    })),

  removeDocument: (id) =>
    set((state) => ({
      documents: state.documents.filter((d) => d.id !== id),
      activeDocumentId:
        state.activeDocumentId === id ? null : state.activeDocumentId,
    })),

  setActiveDocument: (id) => set({ activeDocumentId: id }),

  setCrosswalk: (markdown) =>
    set({
      crosswalkMarkdown: markdown,
      sessionStatus: "crosswalk_done",
      currentTab: "crosswalk",
    }),

  reset: () => set(initialState),
}));
