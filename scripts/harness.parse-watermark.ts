import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  addAndParseDocument,
  chunkDocument,
  createSession,
  deleteSession,
  getSessionDocuments,
  watermarkDocument,
} from "../src/sessions";
import { parseCorpusContent } from "../src/content-helpers";
import { verifyChunkWatermark } from "../src/watermark";

const DEFAULT_SOURCE_TEXT = `
NIST SP 800-53 Rev. 5 — Access Control (AC) Family (Excerpt)

AC-2 Account Management requires organizations to define account types,
approvals, ownership, periodic review, and expiry behavior for temporary
accounts. Access requests should be approved before provisioning.

AC-3 Access Enforcement requires systems to enforce approved authorizations
for information resources through technical controls.

AC-6 Least Privilege requires users and processes to operate with the minimum
permissions needed for assigned tasks, with additional constraints for
privileged operations.

AC-17 Remote Access requires documented restrictions and encrypted sessions
for remote access pathways.
`.trim();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function loadSourceText(): { text: string; filename: string } {
  const sourcePath = process.env.HARNESS_SOURCE_FILE?.trim();
  if (sourcePath) {
    const resolved = resolve(process.cwd(), sourcePath);
    const text = readFileSync(resolved, "utf-8").trim();
    if (!text) throw new Error(`HARNESS_SOURCE_FILE is empty: ${resolved}`);
    const filename = resolved.split("/").at(-1) ?? "harness-input.txt";
    return { text, filename };
  }
  return { text: DEFAULT_SOURCE_TEXT, filename: "harness-input.txt" };
}

async function main() {
  const supabaseUrl = requiredEnv("VITE_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const openrouterApiKey = requiredEnv("OPENROUTER_API_KEY");

  const keepArtifacts =
    process.env.KEEP_HARNESS_ARTIFACTS?.toLowerCase() === "true";

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { text: sourceText, filename } = loadSourceText();

  let sessionId: string | null = null;
  try {
    const session = await createSession(client, {
      name: `harness-parse-watermark-${new Date().toISOString()}`,
    });
    sessionId = session.id;

    console.log(`[harness] session created: ${sessionId}`);

    const parseResult = await addAndParseDocument(client, session.id, sourceText, {
      openrouterApiKey,
      sourceFileName: filename,
      parsePromptProfile: "published_standard",
    });

    console.log(
      `[harness] parse completed: doc=${parseResult.documentId}, model=${parseResult.model}, tokens=${parseResult.inputTokens}/${parseResult.outputTokens}`,
    );

    const chunkResult = await chunkDocument(client, parseResult.documentId);
    console.log(
      `[harness] chunk completed: ${chunkResult.chunkCount} chunks`,
    );

    const watermarkResult = await watermarkDocument(client, parseResult.documentId);
    console.log(
      `[harness] watermark completed: ${watermarkResult.chunkCount} chunks`,
    );

    const docs = await getSessionDocuments(client, session.id);
    const doc = docs.find((item) => item.id === parseResult.documentId);
    if (!doc) {
      throw new Error("Harness failed: parsed document not found in session");
    }

    const markdown = (doc.user_markdown ?? doc.parsed_markdown ?? "").trim();
    if (!markdown) {
      throw new Error("Harness failed: parsed markdown is empty after parse stage");
    }

    const corpus = parseCorpusContent(markdown);
    const chunks = doc.chunks_json ?? [];

    if (chunks.length === 0) {
      throw new Error("Harness failed: chunks_json is empty after watermark stage");
    }

    for (const chunk of chunks) {
      const verification = verifyChunkWatermark(chunk.content);
      if (!verification.valid || !verification.payload) {
        throw new Error(
          `Harness failed: watermark verification failed for sequence ${String(chunk.sequence)} (${verification.reason ?? "unknown"})`,
        );
      }
      if (verification.payload.corpusId !== corpus.corpus_id) {
        throw new Error(
          `Harness failed: corpus_id mismatch for sequence ${String(chunk.sequence)} (expected ${corpus.corpus_id}, got ${verification.payload.corpusId})`,
        );
      }
      if (verification.payload.sequence !== chunk.sequence) {
        throw new Error(
          `Harness failed: sequence mismatch (expected ${String(chunk.sequence)}, got ${String(verification.payload.sequence)})`,
        );
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId,
          documentId: parseResult.documentId,
          corpusId: corpus.corpus_id,
          chunkCount: chunks.length,
          watermarkVerified: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (sessionId && !keepArtifacts) {
      await deleteSession(client, sessionId);
      console.log(`[harness] session deleted: ${sessionId}`);
    } else if (sessionId) {
      console.log(`[harness] keeping session artifacts: ${sessionId}`);
    }
  }
}

main().catch((error) => {
  console.error(
    "[harness] parse→chunk→watermark chain failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
