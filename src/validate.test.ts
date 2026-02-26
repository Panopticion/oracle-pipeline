import { describe, expect, it } from "vitest";
import type { Corpus, ExistingDocument } from "./types";
import {
  hasSubstantiveChanges,
  validateCorpus,
  validateFactCheck,
} from "./validate";
import { hashCorpusContent } from "./content-helpers";

function makeCorpus(overrides: Partial<Corpus> = {}): Corpus {
  return {
    corpus_id: "test-corpus-v1",
    title: "Test Corpus",
    tier: "tier_1",
    frameworks: ["GDPR", "SOC2"],
    industries: ["fintech"],
    segments: ["b2b"],
    source_url: "https://example.com/regulation",
    source_publisher: "Example Publisher",
    last_verified: "2026-02-20",
    version: "1.0.0",
    content_type: "prose",
    content: "## Scope\n\nRegulatory text.",
    filePath: "/tmp/test-corpus-v1.md",
    ...overrides,
  };
}

function makeExistingFromCorpus(corpus: Corpus): ExistingDocument {
  return {
    id: "doc-1",
    corpus_id: corpus.corpus_id,
    version: corpus.version,
    content_hash: hashCorpusContent(corpus),
    tier: corpus.tier,
    content_type: corpus.content_type ?? "prose",
    frameworks: [...corpus.frameworks],
    industries: [...corpus.industries],
    segments: [...corpus.segments],
    source_url: corpus.source_url,
    source_publisher: corpus.source_publisher,
    last_verified: corpus.last_verified,
    title: corpus.title,
    language: corpus.language ?? "en",
  };
}

describe("validateFactCheck", () => {
  it("returns an error when checked_at predates last_verified", () => {
    const corpus = makeCorpus({
      fact_check: {
        status: "verified",
        checked_at: "2026-02-19",
        checked_by: "QA",
      },
    });

    const error = validateFactCheck(corpus);
    expect(error).toContain("must be on/after last_verified");
  });
});

describe("hasSubstantiveChanges", () => {
  it("treats differently ordered arrays as equivalent", () => {
    const corpus = makeCorpus({ frameworks: ["GDPR", "SOC2"] });
    const existing = makeExistingFromCorpus(corpus);
    existing.frameworks = ["SOC2", "GDPR"];

    const changed = hasSubstantiveChanges(
      corpus,
      existing,
      hashCorpusContent(corpus),
    );

    expect(changed).toBe(false);
  });
});

describe("validateCorpus", () => {
  it("fails substantive changes when fact_check is missing and required", () => {
    const corpus = makeCorpus();

    const result = validateCorpus(corpus, {
      requireFactCheck: true,
      existing: null,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("Fact-check required");
  });

  it("allows unchanged corpus without fact_check when gate is required", () => {
    const corpus = makeCorpus();
    const existing = makeExistingFromCorpus(corpus);

    const result = validateCorpus(corpus, {
      requireFactCheck: true,
      existing,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
