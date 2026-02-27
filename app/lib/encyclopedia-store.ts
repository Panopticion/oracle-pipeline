/**
 * Zustand store for Encyclopedia client state.
 *
 * Separate from the session store — Encyclopedia is a persistent,
 * cross-session document library.
 */

import { create } from "zustand";
import type { ChunkData } from "./stores";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EncyclopediaDoc {
  id: string;
  corpusId: string;
  title: string;
  tier: string;
  frameworks: string[];
  industries: string[];
  segments: string[];
  sourceFilename: string;
  markdown: string;
  chunks: ChunkData[] | null;
  sourceSessionId: string | null;
  sourceDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface EncyclopediaState {
  entries: EncyclopediaDoc[];
  selectedIds: Set<string>;
  crosswalkMarkdown: string | null;
  crosswalkChunks: ChunkData[] | null;
  crosswalkGenerating: boolean;

  hydrate: (entries: EncyclopediaDoc[]) => void;
  addEntry: (entry: EncyclopediaDoc) => void;
  removeEntry: (id: string) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  setCrosswalk: (markdown: string | null, chunks?: ChunkData[] | null) => void;
  setCrosswalkGenerating: (generating: boolean) => void;
  reset: () => void;
}

const initialState = {
  entries: [] as EncyclopediaDoc[],
  selectedIds: new Set<string>(),
  crosswalkMarkdown: null as string | null,
  crosswalkChunks: null as ChunkData[] | null,
  crosswalkGenerating: false,
};

export const useEncyclopediaStore = create<EncyclopediaState>()((set) => ({
  ...initialState,

  hydrate: (entries) => set({ entries }),

  addEntry: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries.filter((e) => e.id !== entry.id)],
    })),

  removeEntry: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      next.delete(id);
      return {
        entries: state.entries.filter((e) => e.id !== id),
        selectedIds: next,
      };
    }),

  toggleSelected: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIds: next };
    }),

  clearSelection: () => set({ selectedIds: new Set() }),

  setCrosswalk: (markdown, chunks) =>
    set({ crosswalkMarkdown: markdown, crosswalkChunks: chunks ?? null }),

  setCrosswalkGenerating: (generating) =>
    set({ crosswalkGenerating: generating }),

  reset: () => set(initialState),
}));
