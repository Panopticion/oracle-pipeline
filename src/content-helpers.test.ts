import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { getCorpora, parseCorpusContent, chunkCorpus } from "./content-helpers";

// ─── getCorpora (loads from corpora/ directory) ─────────────────────────────

describe("getCorpora", () => {
  const samplesDir = resolve(import.meta.dirname!, "..", "corpora");

  it("loads all sample corpora from corpora/samples/", () => {
    const corpora = getCorpora(samplesDir);
    expect(corpora.length).toBeGreaterThanOrEqual(5);
  });

  it("each corpus has required fields", () => {
    const corpora = getCorpora(samplesDir);
    for (const corpus of corpora) {
      expect(corpus.corpus_id).toBeTruthy();
      expect(corpus.title).toBeTruthy();
      expect(corpus.tier).toBeTruthy();
      expect(corpus.version).toBeTruthy();
      expect(corpus.content.length).toBeGreaterThan(0);
      expect(corpus.filePath).toContain(".md");
    }
  });

  it("returns empty array for non-existent directory", () => {
    const corpora = getCorpora("/tmp/nonexistent-corpus-dir-12345");
    expect(corpora).toEqual([]);
  });

  it("skips AUTHORING.md", () => {
    const corpora = getCorpora(samplesDir);
    const filePaths = corpora.map((o) => o.filePath);
    expect(filePaths.some((p) => p.endsWith("AUTHORING.md"))).toBe(false);
  });
});

// ─── parseCorpusContent ─────────────────────────────────────────────────────

// Minimal body that passes validation (50+ chars, has ## heading)
const TEST_BODY = `## Section One

This is a test section with enough substantive content to pass the body validation check that requires at least fifty characters of body text after the frontmatter.`;

describe("parseCorpusContent", () => {
  it("parses frontmatter and body", () => {
    const raw = `---
corpus_id: test-corpus-v1
title: Test Corpus
tier: tier_1
version: 1
frameworks: [GDPR, SOC2]
---

${TEST_BODY}
`;
    const corpus = parseCorpusContent(raw);
    expect(corpus.corpus_id).toBe("test-corpus-v1");
    expect(corpus.title).toBe("Test Corpus");
    expect(corpus.tier).toBe("tier_1");
    expect(corpus.version).toBe("1");
    expect(corpus.frameworks).toEqual(["GDPR", "SOC2"]);
    expect(corpus.content).toContain("## Section One");
    expect(corpus.content).toContain("substantive content");
  });

  it("throws on missing frontmatter", () => {
    expect(() => parseCorpusContent("Just some text")).toThrow(
      "missing frontmatter",
    );
  });

  it("throws on missing required fields", () => {
    const raw = `---
corpus_id: test
---

Content
`;
    expect(() => parseCorpusContent(raw)).toThrow("Missing required");
  });

  it("parses nested object (fact_check)", () => {
    const raw = `---
corpus_id: test-nested-v1
title: Test Nested
tier: tier_1
version: 1
frameworks: [GDPR]
fact_check:
  status: verified
  checked_at: "2026-01-10"
  checked_by: Test Team
---

${TEST_BODY}
`;
    const corpus = parseCorpusContent(raw);
    expect(corpus.fact_check).toBeDefined();
    expect(corpus.fact_check!.status).toBe("verified");
    expect(corpus.fact_check!.checked_at).toBe("2026-01-10");
    expect(corpus.fact_check!.checked_by).toBe("Test Team");
  });

  it("parses sire block with arrays", () => {
    const raw = `---
corpus_id: test-sire-v1
title: Test SIRE
tier: tier_1
version: 1
frameworks: [GDPR]
sire:
  subject: data_protection
  included: [personal data, controller, processor]
  excluded: [PHI, HIPAA]
  relevant: [ISO-27001:A.8, SOC2:CC6.1]
---

${TEST_BODY}
`;
    const corpus = parseCorpusContent(raw);
    expect(corpus.sire).toBeDefined();
    expect(corpus.sire!.subject).toBe("data_protection");
    expect(corpus.sire!.included).toEqual([
      "personal data",
      "controller",
      "processor",
    ]);
    expect(corpus.sire!.excluded).toEqual(["PHI", "HIPAA"]);
    expect(corpus.sire!.relevant).toEqual(["ISO-27001:A.8", "SOC2:CC6.1"]);
  });

  it("parses sire with empty arrays", () => {
    const raw = `---
corpus_id: test-sire-empty-v1
title: Test SIRE Empty
tier: tier_1
version: 1
frameworks: [GDPR]
sire:
  subject: cross_framework
  included: [crosswalk]
  excluded: []
  relevant: []
---

${TEST_BODY}
`;
    const corpus = parseCorpusContent(raw);
    expect(corpus.sire).toBeDefined();
    expect(corpus.sire!.subject).toBe("cross_framework");
    expect(corpus.sire!.excluded).toEqual([]);
    expect(corpus.sire!.relevant).toEqual([]);
  });

  it("corpus without sire has undefined sire", () => {
    const raw = `---
corpus_id: test-no-sire-v1
title: Test No SIRE
tier: tier_1
version: 1
frameworks: [GDPR]
---

${TEST_BODY}
`;
    const corpus = parseCorpusContent(raw);
    expect(corpus.sire).toBeUndefined();
  });
});

// ─── chunkCorpus ────────────────────────────────────────────────────────────

describe("chunkCorpus", () => {
  it("chunks a sample corpus into sections", () => {
    const corpora = getCorpora(
      resolve(import.meta.dirname!, "..", "corpora"),
    );
    const gdpr = corpora.find((o) => o.corpus_id === "gdpr-core-v1");
    expect(gdpr).toBeDefined();

    const chunks = chunkCorpus(gdpr!);
    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.content_hash).toBeTruthy();
      expect(chunk.token_count).toBeGreaterThan(0);
    }
  });

  it("preserves heading lines in chunk content", () => {
    // Each section must exceed MIN_CHUNK_WORDS (75) to avoid merge
    const filler =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Curabitur pretium tincidunt lacus nulla gravida orci a odio tonk illic.";
    const raw = `---
corpus_id: heading-test-v1
title: Heading Test
tier: tier_1
version: 1
frameworks: [GDPR]
---

## First Section

${filler}

## Second Section

${filler}
`;
    const corpus = parseCorpusContent(raw);
    const chunks = chunkCorpus(corpus);

    // Each chunk should start with its heading line
    const first = chunks.find((c) => c.section_title === "First Section");
    expect(first).toBeDefined();
    expect(first!.content).toMatch(/^## First Section/);

    const second = chunks.find((c) => c.section_title === "Second Section");
    expect(second).toBeDefined();
    expect(second!.content).toMatch(/^## Second Section/);
  });
});
