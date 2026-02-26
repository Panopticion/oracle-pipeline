/**
 * Provenance watermarking for corpus chunks.
 *
 * Appends an invisible HTML comment to each chunk's content with a
 * cryptographic signature binding the chunk to its corpus, sequence,
 * and content hash. Verifiable even after export from the database.
 *
 * Format: <!-- corpus-watermark:v1:{corpusId}:{sequence}:{signature} -->
 *
 * Default mode: SHA-256 signature (anyone can verify)
 * HMAC mode:   HMAC-SHA-256 with secret (only secret holders can verify)
 *
 * Hardened:
 *   - Input validation on all public functions
 *   - Idempotent injection (existing watermarks are replaced, not duplicated)
 *   - End-anchored regex to avoid matching mid-content
 *   - Deterministic output for crash-recovery idempotency
 */

import { createHash, createHmac } from "node:crypto";
import { WATERMARK_SIGNATURE_LENGTH } from "./constants";

// ─── Constants ───────────────────────────────────────────────────────────────

export const WATERMARK_VERSION = "v1";
export const WATERMARK_PREFIX = "corpus-watermark";

/**
 * Regex to extract the watermark comment from chunk content.
 * Captures: (1) version, (2) corpusId, (3) sequence, (4) signature.
 * End-anchored to only match watermarks at the end of content.
 */
export const WATERMARK_REGEX =
  /<!-- corpus-watermark:(v\d+):([^:]+):(\d+):([a-f0-9]{16}) -->$/m;

/**
 * Broader regex for stripping any watermark comment (including future versions).
 * Used by stripWatermark to ensure forward-compatible removal.
 */
const WATERMARK_STRIP_REGEX = /\n?<!-- corpus-watermark:[^\n]* -->$/;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WatermarkParams {
  /** Corpus identifier (e.g. "gdpr-core-v1"). Must be non-empty. */
  corpusId: string;
  /** Chunk sequence number within the document. Must be >= 0. */
  sequence: number;
  /** SHA-256 hex digest (64 chars) of the original (un-watermarked) chunk content */
  contentHash: string;
  /** Optional HMAC secret. If provided, signature uses HMAC-SHA256. */
  secret?: string;
}

export interface WatermarkPayload {
  version: string;
  corpusId: string;
  sequence: number;
  signature: string;
}

export interface WatermarkVerification {
  valid: boolean;
  payload: WatermarkPayload | null;
  /** If invalid, explains why (missing watermark, version mismatch, tampering) */
  reason?: string;
}

// ─── Input Validation ────────────────────────────────────────────────────────

/** Validate WatermarkParams and throw descriptive errors on invalid input. */
function assertValidParams(params: WatermarkParams): void {
  if (!params.corpusId || typeof params.corpusId !== "string") {
    throw new Error("watermark: corpusId must be a non-empty string");
  }
  if (
    typeof params.sequence !== "number" || params.sequence < 0 ||
    !Number.isInteger(params.sequence)
  ) {
    throw new Error("watermark: sequence must be a non-negative integer");
  }
  if (!params.contentHash || !/^[a-f0-9]{64}$/.test(params.contentHash)) {
    throw new Error(
      "watermark: contentHash must be a 64-char hex SHA-256 digest",
    );
  }
}

// ─── Signature Generation ────────────────────────────────────────────────────

/**
 * Generate the watermark signature.
 *
 * Default: first 16 hex chars of SHA-256(corpusId|sequence|contentHash)
 * With secret: first 16 hex chars of HMAC-SHA-256(secret, same payload)
 *
 * Deterministic: same inputs always produce the same signature.
 */
export function generateSignature(params: WatermarkParams): string {
  assertValidParams(params);

  const data = `${params.corpusId}|${
    String(params.sequence)
  }|${params.contentHash}`;

  if (params.secret) {
    return createHmac("sha256", params.secret)
      .update(data)
      .digest("hex")
      .slice(0, WATERMARK_SIGNATURE_LENGTH);
  }

  return createHash("sha256")
    .update(data)
    .digest("hex")
    .slice(0, WATERMARK_SIGNATURE_LENGTH);
}

// ─── Watermark Injection ─────────────────────────────────────────────────────

/** Generate the full watermark comment string. */
export function buildWatermarkComment(params: WatermarkParams): string {
  const sig = generateSignature(params);
  return `<!-- ${WATERMARK_PREFIX}:${WATERMARK_VERSION}:${params.corpusId}:${
    String(params.sequence)
  }:${sig} -->`;
}

/**
 * Inject a provenance watermark into chunk content.
 *
 * Appends the watermark as an HTML comment at the end.
 * If the content already has a watermark it is replaced (idempotent).
 */
export function injectWatermark(
  content: string,
  params: WatermarkParams,
): string {
  const stripped = stripWatermark(content);
  const comment = buildWatermarkComment(params);
  return `${stripped}\n${comment}`;
}

// ─── Watermark Detection & Extraction ────────────────────────────────────────

/** Check whether content contains a watermark. */
export function isWatermarked(content: string): boolean {
  return WATERMARK_REGEX.test(content);
}

/** Extract the watermark payload from chunk content, or null if absent. */
export function extractWatermark(content: string): WatermarkPayload | null {
  const match = content.match(WATERMARK_REGEX);
  if (!match) return null;

  return {
    version: match[1],
    corpusId: match[2],
    sequence: Number.parseInt(match[3], 10),
    signature: match[4],
  };
}

/**
 * Strip the watermark comment from chunk content.
 * Returns the original un-watermarked content.
 *
 * Uses a broader pattern than extractWatermark to handle future versions.
 */
export function stripWatermark(content: string): string {
  return content.replace(WATERMARK_STRIP_REGEX, "").trimEnd();
}

// ─── Watermark Verification ──────────────────────────────────────────────────

/**
 * Verify a chunk's watermark integrity.
 *
 * Verification loop:
 * 1. Extract watermark from content
 * 2. Strip watermark to recover original content
 * 3. SHA-256 the stripped content → content_hash
 * 4. Recompute expected signature from (corpusId, sequence, content_hash)
 * 5. Compare with extracted signature
 *
 * Self-contained — no database access required. Can verify exported chunks.
 *
 * @param content - The watermarked chunk content (as stored in DB)
 * @param secret - Optional HMAC secret (must match what was used during injection)
 */
export function verifyChunkWatermark(
  content: string,
  secret?: string,
): WatermarkVerification {
  const payload = extractWatermark(content);

  if (!payload) {
    return {
      valid: false,
      payload: null,
      reason: "No watermark found in content",
    };
  }

  if (payload.version !== WATERMARK_VERSION) {
    return {
      valid: false,
      payload,
      reason: `Unsupported watermark version: ${payload.version}`,
    };
  }

  // Strip watermark to recover original content, then hash it
  const originalContent = stripWatermark(content);
  const contentHash = createHash("sha256").update(originalContent).digest(
    "hex",
  );

  // Recompute expected signature
  const expectedSig = generateSignature({
    corpusId: payload.corpusId,
    sequence: payload.sequence,
    contentHash,
    secret,
  });

  if (payload.signature !== expectedSig) {
    return {
      valid: false,
      payload,
      reason: "Signature mismatch — content may have been tampered with",
    };
  }

  return { valid: true, payload };
}

/**
 * Verify watermarks on an array of chunk contents.
 * Returns results in the same order as the input.
 */
export function verifyBatch(
  contents: string[],
  secret?: string,
): WatermarkVerification[] {
  return contents.map((content) => verifyChunkWatermark(content, secret));
}
