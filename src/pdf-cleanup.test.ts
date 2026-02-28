import { describe, expect, it } from "vitest";

import {
  cleanExtractedPdfText,
  cleanExtractedPdfTextWithTelemetry,
} from "./pdf-cleanup";

describe("cleanExtractedPdfText", () => {
  it("removes noisy standards boilerplate while preserving clause content", () => {
    const raw = [
      "ISO/IEC 27001:2022(E)",
      "SNV / licensed to Example Corp",
      "COPYRIGHT PROTECTED DOCUMENT",
      "Contents Page",
      "7. 2 Information security objectives and planning to achieve them 23",
      "12",
      "",
      "ISO/IEC 27001:2022(E)",
      "7. 2 Information security objectives and planning to achieve them",
      "The organization shall establish, implement and maintain information security objectives.",
      "NOTE 1 Objectives should be measurable where practical.",
      "",
      "ISO/IEC 27001:2022(E)",
      "A n n e x A",
    ].join("\n");

    const cleaned = cleanExtractedPdfText(raw);

    expect(cleaned).not.toContain("COPYRIGHT PROTECTED DOCUMENT");
    expect(cleaned).not.toContain("SNV / licensed to Example Corp");
    expect(cleaned).not.toContain("Contents Page");
    expect(cleaned).not.toContain("planning to achieve them 23");
    expect(cleaned).not.toMatch(/^12$/m);

    expect(cleaned).toContain("7.2 Information security objectives and planning to achieve them");
    expect(cleaned).toContain("NOTE 1 Objectives should be measurable where practical.");
    expect(cleaned).toContain("Annex A");
  });

  it("reports telemetry with rule-level counts and non-zero removals on noisy input", () => {
    const raw = [
      "Reference number",
      "ISO/IEC 27001:2022(E)",
      "ISO/IEC 27001:2022(E)",
      "ISO/IEC 27001:2022(E)",
      "Foreword .................................... 5",
      "iv",
      "5.1 Leadership",
    ].join("\n");

    const { text, telemetry } = cleanExtractedPdfTextWithTelemetry(raw);

    expect(text).toContain("5.1 Leadership");
    expect(text).not.toContain("Reference number");
    expect(text).not.toContain("Foreword .................................... 5");

    expect(telemetry.removedChars).toBeGreaterThan(0);
    expect(telemetry.removedLines).toBeGreaterThan(0);
    expect(telemetry.removedByRule.structural).toBe(1);
    expect(telemetry.removedByRule.tableOfContents).toBe(1);
    expect(telemetry.removedByRule.pageMarker).toBe(1);
    expect(telemetry.removedByRule.repeatedHeaderFooter).toBe(3);
    expect(telemetry.removedCharRatio).toBeGreaterThan(0);
  });
});