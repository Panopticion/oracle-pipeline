/**
 * Content helper functions for corpus loading, parsing, chunking, and hashing.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Corpus, CorpusChunkRaw } from "./types";

// ─── Hashing ──────────────────────────────────────────────────────────────────

/** SHA-256 hex digest of corpus markdown content (body only, no frontmatter). */
export function hashCorpusContent(corpus: Corpus): string {
  return createHash("sha256").update(corpus.content).digest("hex");
}

/** SHA-256 hex digest of a string. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

const MIN_CHUNK_WORDS = 75;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function tokenCount(text: string): number {
  return Math.ceil(wordCount(text) / 0.75);
}

/**
 * Split corpus content into chunks suitable for embedding.
 *
 * Phase 1: Split on ## (H2) heading boundaries
 * Phase 2: Sub-split oversized chunks (>500 words) on ### boundaries or paragraph breaks
 * Phase 3: Merge undersized chunks (<75 words) into predecessor
 */
export function chunkCorpus(corpus: Corpus): CorpusChunkRaw[] {
  const lines = corpus.content.split("\n");
  const sections: {
    title: string;
    level: number;
    content: string;
    headingPath: string[];
  }[] = [];

  let currentTitle = corpus.title;
  let currentLevel = 2;
  let currentLines: string[] = [];
  let headingPath = [corpus.title];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/);
    const h3Match = line.match(/^###\s+(.+)/);

    if (h2Match) {
      if (currentLines.length > 0) {
        sections.push({
          title: currentTitle,
          level: currentLevel,
          content: currentLines.join("\n").trim(),
          headingPath: [...headingPath],
        });
      }
      currentTitle = h2Match[1].trim();
      currentLevel = 2;
      headingPath = [corpus.title, currentTitle];
      currentLines = [line]; // preserve heading in chunk content
    } else if (h3Match) {
      if (currentLines.length > 0) {
        sections.push({
          title: currentTitle,
          level: currentLevel,
          content: currentLines.join("\n").trim(),
          headingPath: [...headingPath],
        });
      }
      currentTitle = h3Match[1].trim();
      currentLevel = 3;
      headingPath = [corpus.title, currentTitle];
      currentLines = [line]; // preserve heading in chunk content
    } else {
      currentLines.push(line);
    }
  }

  // Flush remaining
  if (currentLines.length > 0) {
    sections.push({
      title: currentTitle,
      level: currentLevel,
      content: currentLines.join("\n").trim(),
      headingPath: [...headingPath],
    });
  }

  // Filter empty and merge small chunks
  const filtered = sections.filter((s) => s.content.length > 0);
  const merged: typeof filtered = [];

  for (const section of filtered) {
    if (merged.length > 0 && wordCount(section.content) < MIN_CHUNK_WORDS) {
      const prev = merged[merged.length - 1];
      prev.content += "\n\n" + section.content;
    } else {
      merged.push({ ...section });
    }
  }

  return merged.map((section, i) => ({
    sequence: i,
    section_title: section.title,
    heading_level: section.level,
    content: section.content,
    content_hash: sha256(section.content),
    token_count: tokenCount(section.content),
    heading_path: section.headingPath,
  }));
}

// ─── Crosswalk Chunking ──────────────────────────────────────────────────────

/**
 * Chunk crosswalk markdown into sections on H2/H3 heading boundaries.
 *
 * Unlike `chunkCorpus()`, this does not require YAML frontmatter — it
 * operates on raw markdown (the output of crosswalk generation).
 *
 * @param corpusId — Synthetic corpus_id for the crosswalk (e.g. "crosswalk-v1-{sessionId}")
 * @param markdown — Raw crosswalk markdown
 */
export function chunkCrosswalkMarkdown(
  corpusId: string,
  markdown: string,
): CorpusChunkRaw[] {
  const lines = markdown.split("\n");
  const sections: {
    title: string;
    level: number;
    content: string;
    headingPath: string[];
  }[] = [];

  let currentTitle = "Crosswalk";
  let currentLevel = 2;
  let currentLines: string[] = [];
  let headingPath = ["Crosswalk"];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/);
    const h3Match = line.match(/^###\s+(.+)/);

    if (h2Match) {
      if (currentLines.length > 0) {
        sections.push({
          title: currentTitle,
          level: currentLevel,
          content: currentLines.join("\n").trim(),
          headingPath: [...headingPath],
        });
      }
      currentTitle = h2Match[1].trim();
      currentLevel = 2;
      headingPath = ["Crosswalk", currentTitle];
      currentLines = [line];
    } else if (h3Match) {
      if (currentLines.length > 0) {
        sections.push({
          title: currentTitle,
          level: currentLevel,
          content: currentLines.join("\n").trim(),
          headingPath: [...headingPath],
        });
      }
      currentTitle = h3Match[1].trim();
      currentLevel = 3;
      headingPath = ["Crosswalk", currentTitle];
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Flush remaining
  if (currentLines.length > 0) {
    sections.push({
      title: currentTitle,
      level: currentLevel,
      content: currentLines.join("\n").trim(),
      headingPath: [...headingPath],
    });
  }

  // Filter empty and merge small chunks
  const filtered = sections.filter((s) => s.content.length > 0);
  const merged: typeof filtered = [];

  for (const section of filtered) {
    if (merged.length > 0 && wordCount(section.content) < MIN_CHUNK_WORDS) {
      const prev = merged[merged.length - 1];
      prev.content += "\n\n" + section.content;
    } else {
      merged.push({ ...section });
    }
  }

  return merged.map((section, i) => ({
    sequence: i,
    section_title: section.title,
    heading_level: section.level,
    content: section.content,
    content_hash: sha256(section.content),
    token_count: tokenCount(section.content),
    heading_path: section.headingPath,
  }));
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse raw markdown (frontmatter + body) into an Corpus object.
 *
 * Expects YAML frontmatter delimited by --- lines.
 * Throws on missing required fields.
 */
export function parseCorpusContent(rawMarkdown: string): Corpus {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = rawMarkdown.match(fmRegex);

  if (!match) {
    throw new Error(
      "Invalid corpus content: missing frontmatter delimiters (---)",
    );
  }

  const frontmatterBlock = match[1];
  const body = match[2].trim();

  // Simple YAML-ish parser for frontmatter (flat values + one-level nesting)
  const data: Record<string, unknown> = {};
  const fmLines = frontmatterBlock.split("\n");

  for (let li = 0; li < fmLines.length; li++) {
    const line = fmLines[li];

    // Top-level key with value on the same line
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.+)/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: unknown = kvMatch[2].trim();

      // Handle arrays: [a, b, c]
      if (
        typeof value === "string" &&
        value.startsWith("[") &&
        value.endsWith("]")
      ) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }

      // Handle quoted strings
      if (typeof value === "string" && /^["'].*["']$/.test(value)) {
        value = value.slice(1, -1);
      }

      data[key] = value;
      continue;
    }

    // Top-level key with no value — start of a nested block (e.g. fact_check:, sire:)
    const blockMatch = line.match(/^(\w[\w_]*)\s*:\s*$/);
    if (blockMatch) {
      const key = blockMatch[1];
      const nested: Record<string, unknown> = {};

      // Consume indented lines
      while (li + 1 < fmLines.length && /^\s+/.test(fmLines[li + 1])) {
        li++;
        const nestedKv = fmLines[li].match(/^\s+(\w[\w_]*)\s*:\s*(.+)/);
        if (nestedKv) {
          let val: unknown = nestedKv[2].trim();

          // Handle arrays: [a, b, c]
          if (
            typeof val === "string" &&
            val.startsWith("[") &&
            val.endsWith("]")
          ) {
            val = val
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim().replace(/^["']|["']$/g, ""))
              .filter(Boolean);
          }

          // Handle quoted strings
          if (typeof val === "string" && /^["'].*["']$/.test(val)) {
            val = val.slice(1, -1);
          }

          nested[nestedKv[1]] = val;
        }
      }

      data[key] = nested;
    }
  }

  const required = ["corpus_id", "title", "tier", "version"];
  for (const field of required) {
    if (!data[field]) {
      throw new Error(`Missing required frontmatter field: ${field}`);
    }
  }

  // Body must contain substantive content with at least one ## heading
  if (!body || body.length < 50) {
    throw new Error(
      "Body content is missing or too short — expected structured markdown with ## headings after the frontmatter",
    );
  }
  if (!/^##\s/m.test(body)) {
    throw new Error(
      "Body content must contain at least one ## (H2) heading for chunk boundaries",
    );
  }

  return {
    corpus_id: String(data.corpus_id),
    title: String(data.title),
    tier: String(data.tier),
    frameworks: Array.isArray(data.frameworks) ? data.frameworks : [],
    industries: Array.isArray(data.industries) ? data.industries : [],
    segments: Array.isArray(data.segments) ? data.segments : [],
    source_url: String(data.source_url ?? ""),
    source_publisher: String(data.source_publisher ?? ""),
    last_verified: String(data.last_verified ?? ""),
    version: String(data.version),
    content_type: data.content_type as Corpus["content_type"],
    language: data.language ? String(data.language) : undefined,
    fact_check: data.fact_check as Corpus["fact_check"],
    sire: data.sire as Corpus["sire"],
    content: body,
    filePath: "(inline content)",
  };
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/**
 * Recursively find all `.md` files under `dir`, skipping `AUTHORING.md`.
 */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = String(entry.name);
    const full = join(dir, name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(full));
    } else if (name.endsWith(".md") && name !== "AUTHORING.md") {
      results.push(full);
    }
  }
  return results;
}

/**
 * Load all corpus Markdown files from a directory (recursively).
 *
 * @param dir - Root directory to scan. Defaults to `corpora/` relative to `process.cwd()`.
 * @returns Parsed `Corpus[]`. Returns `[]` if the directory does not exist.
 */
export function getCorpora(dir?: string): Corpus[] {
  const root = dir ?? resolve(process.cwd(), "corpora");
  if (!existsSync(root)) return [];

  return findMarkdownFiles(root).map((filePath) => {
    const raw = readFileSync(filePath, "utf-8");
    const corpus = parseCorpusContent(raw);
    corpus.filePath = filePath;
    return corpus;
  });
}
