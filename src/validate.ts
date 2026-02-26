/**
 * Corpus format validation + fact-check gate.
 *
 * Validates frontmatter completeness, tier constraints, and optional
 * fact-check requirements before allowing ingestion.
 */

import type { Corpus, ExistingDocument, ValidationResult } from "./types";
import { chunkCorpus, getCorpora, hashCorpusContent } from "./content-helpers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a.at(i) !== b.at(i)) return false;
  }
  return true;
}

// ─── Fact-check detection ─────────────────────────────────────────────────────

/**
 * Detect whether an corpus has substantive changes relative to its existing
 * Supabase document. If so, a verified fact-check is required.
 *
 * Returns true when:
 *   - The corpus is new (no existing document)
 *   - Content hash differs
 *   - Any metadata field (version, title, tier, frameworks, etc.) differs
 */
export function hasSubstantiveChanges(
  corpus: Corpus,
  existing: ExistingDocument | null,
  contentHash: string,
): boolean {
  if (!existing) return true;

  return (
    existing.content_hash !== contentHash ||
    existing.version !== corpus.version ||
    existing.title !== corpus.title ||
    existing.tier !== corpus.tier ||
    existing.content_type !== (corpus.content_type ?? "prose") ||
    existing.source_url !== corpus.source_url ||
    existing.source_publisher !== corpus.source_publisher ||
    existing.last_verified !== corpus.last_verified ||
    !arraysEqual(
      normalizeStringArray(existing.frameworks),
      [...corpus.frameworks].sort(),
    ) ||
    !arraysEqual(
      normalizeStringArray(existing.industries),
      [...corpus.industries].sort(),
    ) ||
    !arraysEqual(
      normalizeStringArray(existing.segments),
      [...corpus.segments].sort(),
    )
  );
}

/**
 * Validate the fact_check frontmatter block for ingestion readiness.
 * Returns a descriptive error string, or null if valid.
 */
export function validateFactCheck(corpus: Corpus): string | null {
  const fc = corpus.fact_check;
  if (!fc) {
    return (
      "Missing fact_check frontmatter. Add:\n" +
      "fact_check:\n" +
      "  status: verified\n" +
      "  checked_at: YYYY-MM-DD\n" +
      "  checked_by: <name>"
    );
  }

  if (fc.status !== "verified") {
    return `fact_check.status must be "verified" (got "${fc.status}")`;
  }

  if (!fc.checked_at || !isIsoDateString(fc.checked_at)) {
    return `fact_check.checked_at must be YYYY-MM-DD (got "${fc.checked_at}")`;
  }

  if (!fc.checked_by || !fc.checked_by.trim()) {
    return "fact_check.checked_by must be a non-empty string";
  }

  if (
    isIsoDateString(corpus.last_verified) &&
    fc.checked_at < corpus.last_verified
  ) {
    return (
      `fact_check.checked_at (${fc.checked_at}) must be on/after last_verified ` +
      `(${corpus.last_verified})`
    );
  }

  return null;
}

// ─── Core validation ──────────────────────────────────────────────────────────

export interface ValidateOptions {
  /** If true, enforce fact_check.status === "verified" for substantive changes */
  requireFactCheck?: boolean;
  /** Existing document from Supabase (for change detection) */
  existing?: ExistingDocument | null;
}

/**
 * Validate a single corpus document.
 *
 * Checks:
 *   1. Frontmatter is valid (already enforced by getCorpora, but we add warnings)
 *   2. Content produces at least one chunk
 *   3. Fact-check gate (if requireFactCheck and document has substantive changes)
 */
export function validateCorpus(
  corpus: Corpus,
  options: ValidateOptions = {},
): ValidationResult {
  const { requireFactCheck = false, existing = null } = options;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Structure checks
  const chunks = chunkCorpus(corpus);
  if (chunks.length === 0) {
    errors.push("Corpus produces zero chunks — needs at least one ## heading");
  }

  const contentHash = hashCorpusContent(corpus);

  // Warn on empty fields
  if (corpus.frameworks.length === 0) {
    warnings.push("frameworks array is empty");
  }
  if (corpus.industries.length === 0) {
    warnings.push("industries array is empty");
  }
  if (corpus.segments.length === 0) {
    warnings.push("segments array is empty");
  }

  // Fact-check gate (only when required and corpus has substantive changes)
  if (requireFactCheck) {
    const isSubstantive = hasSubstantiveChanges(corpus, existing, contentHash);

    if (isSubstantive) {
      const fcError = validateFactCheck(corpus);
      if (fcError) {
        errors.push(`Fact-check required: ${fcError}`);
      }
    }
  } else if (!corpus.fact_check) {
    warnings.push(
      "No fact_check block — consider adding for production corpora",
    );
  }

  return {
    corpus_id: corpus.corpus_id,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all corpus documents from disk.
 */
export function validateAllCorpora(
  options: Omit<ValidateOptions, "existing"> = {},
): ValidationResult[] {
  const corpora = getCorpora();
  return corpora.map((corpus) => validateCorpus(corpus, options));
}
