import { describe, expect, it } from "vitest";

import { parsePdfExtractorMode } from "./pdf-extract";

describe("parsePdfExtractorMode", () => {
  it("defaults to auto when unset", () => {
    expect(parsePdfExtractorMode(undefined)).toBe("auto");
  });

  it("accepts valid values", () => {
    expect(parsePdfExtractorMode("pdfjs")).toBe("pdfjs");
    expect(parsePdfExtractorMode("pdfparse")).toBe("pdfparse");
    expect(parsePdfExtractorMode("auto")).toBe("auto");
  });

  it("normalizes case and whitespace", () => {
    expect(parsePdfExtractorMode(" PDFJS ")).toBe("pdfjs");
  });

  it("falls back to auto for invalid values", () => {
    expect(parsePdfExtractorMode("plumber")).toBe("auto");
  });
});