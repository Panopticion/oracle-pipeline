import { useCallback } from "react";
import {
  chunkDocResult,
  extractUploadTextResult,
  extractUrlTextResult,
  generateCrosswalkResult,
  insertDocForParseResult,
  markCompleteResult,
  promoteDocResult,
  removeDocumentResult,
  reparseDocumentResult,
  saveCrosswalkEditResult,
  saveEditResult,
  stopParseJobResult,
  watermarkDocResult,
} from "@/server/session-actions";
import type { ServerResult } from "@/lib/global-state-types";

type ParsePromptProfile = "published_standard" | "interpretation" | "firecrawl_prepped";

type ChunkRecord = {
  sequence: number;
  section_title: string;
  heading_level: number;
  content: string;
  content_hash: string;
  token_count: number;
  heading_path: string[];
};

type ChunkOperationResult = {
  chunks: ChunkRecord[];
};

type WatermarkOperationResult = {
  chunks: ChunkRecord[];
};

type CrosswalkResult = {
  sessionId: string;
  model: string;
  crosswalkMarkdown: string;
  crosswalkChunks: ChunkRecord[];
};

function unwrapServerResult<T>(result: ServerResult<T>): T {
  if (result.ok) return result.data;
  throw new Error(result.error.message);
}

export function useSessionWorkflowOps() {
  const extractUploadText = useCallback(async (data: { fileName: string; fileBase64: string }) => {
    const result = await extractUploadTextResult({ data });
    return unwrapServerResult(result);
  }, []);

  const extractUrlText = useCallback(async (data: { url: string }) => {
    const result = await extractUrlTextResult({ data });
    return unwrapServerResult(result);
  }, []);

  const insertDocForParse = useCallback(async (data: {
    sessionId: string;
    sourceText: string;
    sourceFileName?: string;
  }) => {
    const result = await insertDocForParseResult({ data });
    return unwrapServerResult(result);
  }, []);

  const reparseDocument = useCallback(async (data: {
    documentId: string;
    parsePromptProfile?: ParsePromptProfile;
  }) => {
    const result = await reparseDocumentResult({ data });
    return unwrapServerResult(result);
  }, []);

  const stopParseJob = useCallback(async (data: { documentId: string }) => {
    const result = await stopParseJobResult({ data });
    return unwrapServerResult(result);
  }, []);

  const saveEdit = useCallback(async (data: { documentId: string; userMarkdown: string }) => {
    const result = await saveEditResult({ data });
    return unwrapServerResult(result);
  }, []);

  const removeDocument = useCallback(async (data: { documentId: string }) => {
    const result = await removeDocumentResult({ data });
    return unwrapServerResult(result);
  }, []);

  const chunkDocument = useCallback(async (data: { documentId: string }) => {
    const result = await chunkDocResult({ data });
    return unwrapServerResult<ChunkOperationResult>(result);
  }, []);

  const watermarkDocument = useCallback(async (data: { documentId: string }) => {
    const result = await watermarkDocResult({ data });
    return unwrapServerResult<WatermarkOperationResult>(result);
  }, []);

  const promoteDocument = useCallback(async (data: { documentId: string }) => {
    const result = await promoteDocResult({ data });
    return unwrapServerResult(result);
  }, []);

  const markSessionComplete = useCallback(async (data: { sessionId: string }) => {
    const result = await markCompleteResult({ data });
    return unwrapServerResult(result);
  }, []);

  const generateCrosswalk = useCallback(async (data: { sessionId: string }) => {
    const result = await generateCrosswalkResult({ data });
    return unwrapServerResult<CrosswalkResult>(result);
  }, []);

  const saveCrosswalkEdit = useCallback(async (data: { sessionId: string; markdown: string }) => {
    const result = await saveCrosswalkEditResult({ data });
    return unwrapServerResult(result);
  }, []);

  return {
    extractUploadText,
    extractUrlText,
    insertDocForParse,
    reparseDocument,
    stopParseJob,
    saveEdit,
    removeDocument,
    chunkDocument,
    watermarkDocument,
    promoteDocument,
    markSessionComplete,
    generateCrosswalk,
    saveCrosswalkEdit,
  };
}
