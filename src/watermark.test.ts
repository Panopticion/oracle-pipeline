import { describe, expect, it } from "vitest";
import {
  generateSignature,
  buildWatermarkComment,
  injectWatermark,
  extractWatermark,
  stripWatermark,
  isWatermarked,
  verifyChunkWatermark,
  verifyBatch,
  WATERMARK_VERSION,
  WATERMARK_REGEX,
} from "./watermark";
import { createHash } from "node:crypto";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const sampleContent =
  "This is a chunk of compliance content about GDPR Article 5.";
const sampleHash = sha256(sampleContent);

const baseParams = {
  corpusId: "gdpr-core-v1",
  sequence: 3,
  contentHash: sampleHash,
};

// ─── generateSignature ──────────────────────────────────────────────────────

describe("generateSignature", () => {
  it("produces a 16-character hex string", () => {
    const sig = generateSignature(baseParams);
    expect(sig).toMatch(/^[a-f0-9]{16}$/);
  });

  it("is deterministic", () => {
    expect(generateSignature(baseParams)).toBe(generateSignature(baseParams));
  });

  it("changes when corpusId changes", () => {
    const sig1 = generateSignature(baseParams);
    const sig2 = generateSignature({ ...baseParams, corpusId: "hipaa-core-v1" });
    expect(sig1).not.toBe(sig2);
  });

  it("changes when sequence changes", () => {
    const sig1 = generateSignature(baseParams);
    const sig2 = generateSignature({ ...baseParams, sequence: 4 });
    expect(sig1).not.toBe(sig2);
  });

  it("changes when contentHash changes", () => {
    const sig1 = generateSignature(baseParams);
    const sig2 = generateSignature({
      ...baseParams,
      contentHash: sha256("different"),
    });
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signature with HMAC secret", () => {
    const plain = generateSignature(baseParams);
    const hmac = generateSignature({ ...baseParams, secret: "my-secret" });
    expect(plain).not.toBe(hmac);
    expect(hmac).toMatch(/^[a-f0-9]{16}$/);
  });

  it("HMAC is deterministic with same secret", () => {
    const a = generateSignature({ ...baseParams, secret: "s3cret" });
    const b = generateSignature({ ...baseParams, secret: "s3cret" });
    expect(a).toBe(b);
  });

  it("different secrets produce different signatures", () => {
    const a = generateSignature({ ...baseParams, secret: "key-a" });
    const b = generateSignature({ ...baseParams, secret: "key-b" });
    expect(a).not.toBe(b);
  });
});

// ─── buildWatermarkComment ──────────────────────────────────────────────────

describe("buildWatermarkComment", () => {
  it("produces a valid HTML comment matching the regex", () => {
    const comment = buildWatermarkComment(baseParams);
    expect(comment).toMatch(
      /^<!-- corpus-watermark:v1:gdpr-core-v1:3:[a-f0-9]{16} -->$/,
    );
    expect(comment).toMatch(WATERMARK_REGEX);
  });
});

// ─── injectWatermark ────────────────────────────────────────────────────────

describe("injectWatermark", () => {
  it("appends watermark comment to content", () => {
    const result = injectWatermark(sampleContent, baseParams);
    expect(result).toContain(sampleContent);
    expect(result).toMatch(WATERMARK_REGEX);
    const lines = result.split("\n");
    expect(lines[lines.length - 1]).toMatch(/^<!-- corpus-watermark:/);
  });

  it("is idempotent", () => {
    const first = injectWatermark(sampleContent, baseParams);
    const second = injectWatermark(first, baseParams);
    expect(second).toBe(first);
  });

  it("replaces different watermark on re-injection", () => {
    const first = injectWatermark(sampleContent, {
      ...baseParams,
      secret: "old",
    });
    const second = injectWatermark(first, { ...baseParams, secret: "new" });
    const matches = second.match(/<!-- corpus-watermark:/g);
    expect(matches?.length).toBe(1);
  });
});

// ─── extractWatermark ───────────────────────────────────────────────────────

describe("extractWatermark", () => {
  it("extracts watermark from watermarked content", () => {
    const watermarked = injectWatermark(sampleContent, baseParams);
    const payload = extractWatermark(watermarked);
    expect(payload).not.toBeNull();
    expect(payload!.version).toBe(WATERMARK_VERSION);
    expect(payload!.corpusId).toBe("gdpr-core-v1");
    expect(payload!.sequence).toBe(3);
    expect(payload!.signature).toMatch(/^[a-f0-9]{16}$/);
  });

  it("returns null for content without watermark", () => {
    expect(extractWatermark(sampleContent)).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(extractWatermark("")).toBeNull();
  });
});

// ─── stripWatermark ─────────────────────────────────────────────────────────

describe("stripWatermark", () => {
  it("removes watermark and recovers original content", () => {
    const watermarked = injectWatermark(sampleContent, baseParams);
    expect(stripWatermark(watermarked)).toBe(sampleContent);
  });

  it("is a no-op on content without watermark", () => {
    expect(stripWatermark(sampleContent)).toBe(sampleContent);
  });

  it("stripped content hashes to original content_hash", () => {
    const watermarked = injectWatermark(sampleContent, baseParams);
    expect(sha256(stripWatermark(watermarked))).toBe(sampleHash);
  });
});

// ─── verifyChunkWatermark ───────────────────────────────────────────────────

describe("verifyChunkWatermark", () => {
  it("verifies a valid watermarked chunk (default mode)", () => {
    const watermarked = injectWatermark(sampleContent, baseParams);
    const result = verifyChunkWatermark(watermarked);
    expect(result.valid).toBe(true);
    expect(result.payload!.corpusId).toBe("gdpr-core-v1");
  });

  it("verifies a valid watermarked chunk (HMAC mode)", () => {
    const secret = "compliance-secret";
    const watermarked = injectWatermark(sampleContent, {
      ...baseParams,
      secret,
    });
    expect(verifyChunkWatermark(watermarked, secret).valid).toBe(true);
  });

  it("fails when content is tampered", () => {
    const watermarked = injectWatermark(sampleContent, baseParams);
    const tampered = watermarked.replace("GDPR", "HIPAA");
    const result = verifyChunkWatermark(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Signature mismatch");
  });

  it("fails when HMAC secret is wrong", () => {
    const watermarked = injectWatermark(sampleContent, {
      ...baseParams,
      secret: "correct",
    });
    const result = verifyChunkWatermark(watermarked, "wrong");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Signature mismatch");
  });

  it("fails when no watermark is present", () => {
    const result = verifyChunkWatermark(sampleContent);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("No watermark found");
  });

  it("returns payload even on verification failure", () => {
    const watermarked = injectWatermark(sampleContent, baseParams);
    const tampered = watermarked.replace("GDPR", "HIPAA");
    const result = verifyChunkWatermark(tampered);
    expect(result.valid).toBe(false);
    expect(result.payload).not.toBeNull();
    expect(result.payload!.corpusId).toBe("gdpr-core-v1");
  });
});

// ─── Round-trip integration ─────────────────────────────────────────────────

describe("round-trip", () => {
  it("inject → extract → verify → strip reproduces original", () => {
    const watermarked = injectWatermark(sampleContent, baseParams);
    expect(extractWatermark(watermarked)).not.toBeNull();
    expect(verifyChunkWatermark(watermarked).valid).toBe(true);
    expect(stripWatermark(watermarked)).toBe(sampleContent);
    expect(sha256(stripWatermark(watermarked))).toBe(sampleHash);
  });

  it("works with multi-line markdown content", () => {
    const md = [
      "Article 5(1)(a) of the GDPR requires that personal data shall be:",
      "",
      "- processed lawfully, fairly, and in a transparent manner",
      "- collected for specified, explicit, and legitimate purposes",
      "- adequate, relevant, and limited to what is necessary",
    ].join("\n");

    const hash = sha256(md);
    const params = { corpusId: "gdpr-core-v1", sequence: 0, contentHash: hash };
    const watermarked = injectWatermark(md, params);
    expect(verifyChunkWatermark(watermarked).valid).toBe(true);
    expect(stripWatermark(watermarked)).toBe(md);
  });
});

// ─── Input validation ──────────────────────────────────────────────────────

describe("input validation", () => {
  it("rejects empty corpusId", () => {
    expect(() =>
      generateSignature({ ...baseParams, corpusId: "" }),
    ).toThrow("corpusId must be a non-empty string");
  });

  it("rejects negative sequence", () => {
    expect(() =>
      generateSignature({ ...baseParams, sequence: -1 }),
    ).toThrow("sequence must be a non-negative integer");
  });

  it("rejects fractional sequence", () => {
    expect(() =>
      generateSignature({ ...baseParams, sequence: 1.5 }),
    ).toThrow("sequence must be a non-negative integer");
  });

  it("rejects invalid contentHash (too short)", () => {
    expect(() =>
      generateSignature({ ...baseParams, contentHash: "abc123" }),
    ).toThrow("contentHash must be a 64-char hex SHA-256 digest");
  });

  it("rejects invalid contentHash (uppercase)", () => {
    expect(() =>
      generateSignature({
        ...baseParams,
        contentHash: sampleHash.toUpperCase(),
      }),
    ).toThrow("contentHash must be a 64-char hex SHA-256 digest");
  });

  it("validation propagates through injectWatermark", () => {
    expect(() =>
      injectWatermark(sampleContent, { ...baseParams, corpusId: "" }),
    ).toThrow("corpusId must be a non-empty string");
  });
});

// ─── isWatermarked ─────────────────────────────────────────────────────────

describe("isWatermarked", () => {
  it("returns true for watermarked content", () => {
    const watermarked = injectWatermark(sampleContent, baseParams);
    expect(isWatermarked(watermarked)).toBe(true);
  });

  it("returns false for plain content", () => {
    expect(isWatermarked(sampleContent)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isWatermarked("")).toBe(false);
  });

  it("returns false for content with watermark-like text mid-content", () => {
    const misleading =
      "See <!-- corpus-watermark:v1:fake:0:0000000000000000 --> above.\nMore content here.";
    expect(isWatermarked(misleading)).toBe(false);
  });
});

// ─── verifyBatch ───────────────────────────────────────────────────────────

describe("verifyBatch", () => {
  it("verifies multiple chunks in order", () => {
    const contents = [0, 1, 2].map((seq) => {
      const content = `Chunk ${String(seq)} content`;
      const hash = sha256(content);
      return injectWatermark(content, {
        corpusId: "batch-test",
        sequence: seq,
        contentHash: hash,
      });
    });

    const results = verifyBatch(contents);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.valid).toBe(true);
    }
    expect(results[0].payload!.sequence).toBe(0);
    expect(results[2].payload!.sequence).toBe(2);
  });

  it("reports individual failures within a batch", () => {
    const good = injectWatermark(sampleContent, baseParams);
    const tampered = good.replace("GDPR", "HIPAA");
    const results = verifyBatch([good, tampered, sampleContent]);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].reason).toContain("Signature mismatch");
    expect(results[2].valid).toBe(false);
    expect(results[2].reason).toContain("No watermark found");
  });

  it("supports HMAC secret", () => {
    const secret = "batch-secret";
    const watermarked = injectWatermark(sampleContent, {
      ...baseParams,
      secret,
    });
    const results = verifyBatch([watermarked], secret);
    expect(results[0].valid).toBe(true);
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles content with existing HTML comments", () => {
    const content = "Some text <!-- existing comment --> more text";
    const hash = sha256(content);
    const params = { corpusId: "html-test", sequence: 0, contentHash: hash };
    const watermarked = injectWatermark(content, params);
    expect(verifyChunkWatermark(watermarked).valid).toBe(true);
    expect(stripWatermark(watermarked)).toBe(content);
  });

  it("handles content with special characters in corpus ID", () => {
    const content = "Special chars test";
    const hash = sha256(content);
    const params = {
      corpusId: "gdpr-2024_v2.1",
      sequence: 0,
      contentHash: hash,
    };
    const watermarked = injectWatermark(content, params);
    expect(verifyChunkWatermark(watermarked).valid).toBe(true);
    expect(extractWatermark(watermarked)!.corpusId).toBe("gdpr-2024_v2.1");
  });

  it("handles sequence 0 (first chunk)", () => {
    const content = "First chunk";
    const hash = sha256(content);
    const params = { corpusId: "zero-test", sequence: 0, contentHash: hash };
    const watermarked = injectWatermark(content, params);
    expect(verifyChunkWatermark(watermarked).valid).toBe(true);
    expect(extractWatermark(watermarked)!.sequence).toBe(0);
  });

  it("handles large sequence numbers", () => {
    const content = "Large sequence test";
    const hash = sha256(content);
    const params = { corpusId: "big-seq", sequence: 99999, contentHash: hash };
    const watermarked = injectWatermark(content, params);
    expect(verifyChunkWatermark(watermarked).valid).toBe(true);
    expect(extractWatermark(watermarked)!.sequence).toBe(99999);
  });

  it("handles content with trailing whitespace", () => {
    const content = "Content with trailing space   ";
    const hash = sha256(content.trimEnd());
    const params = { corpusId: "ws-test", sequence: 0, contentHash: hash };
    // stripWatermark calls trimEnd(), so hash the trimmed version
    const watermarked = injectWatermark(content, params);
    const result = verifyChunkWatermark(watermarked);
    // The stripped content is trimEnd'd — matches hash of trimmed content
    expect(result.valid).toBe(true);
  });
});
