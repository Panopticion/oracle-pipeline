import { describe, expect, it } from "vitest";
import { mapWithConcurrency, mapSettledWithConcurrency } from "./concurrency";

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── mapWithConcurrency ─────────────────────────────────────────────────────

describe("mapWithConcurrency", () => {
  it("returns results in order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, async (x) => x * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("handles empty array", async () => {
    const results = await mapWithConcurrency([], 3, async (x: number) => x);
    expect(results).toEqual([]);
  });

  it("respects concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(10);
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThanOrEqual(1);
  });

  it("propagates first error", async () => {
    const items = [1, 2, 3];
    await expect(
      mapWithConcurrency(items, 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });

  it("works with concurrency greater than items", async () => {
    const items = [1, 2];
    const results = await mapWithConcurrency(items, 100, async (x) => x);
    expect(results).toEqual([1, 2]);
  });

  it("passes index to callback", async () => {
    const items = ["a", "b", "c"];
    const results = await mapWithConcurrency(items, 2, async (_, i) => i);
    expect(results).toEqual([0, 1, 2]);
  });

  it("throws when concurrency is less than 1", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 0, async (x) => x),
    ).rejects.toThrow("concurrency must be a positive integer");
  });

  it("throws when concurrency is non-integer", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 1.5, async (x) => x),
    ).rejects.toThrow("concurrency must be a positive integer");
  });
});

// ─── mapSettledWithConcurrency ──────────────────────────────────────────────

describe("mapSettledWithConcurrency", () => {
  it("returns fulfilled results in order", async () => {
    const items = [1, 2, 3];
    const results = await mapSettledWithConcurrency(
      items,
      2,
      async (x) => x * 10,
    );
    expect(results).toEqual([
      { status: "fulfilled", value: 10 },
      { status: "fulfilled", value: 20 },
      { status: "fulfilled", value: 30 },
    ]);
  });

  it("handles empty array", async () => {
    const results = await mapSettledWithConcurrency(
      [],
      3,
      async (x: number) => x,
    );
    expect(results).toEqual([]);
  });

  it("captures errors without stopping other items", async () => {
    const items = [1, 2, 3];
    const results = await mapSettledWithConcurrency(items, 1, async (x) => {
      if (x === 2) throw new Error("fail");
      return x * 10;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[1]).toMatchObject({ status: "rejected" });
    expect(results[2]).toEqual({ status: "fulfilled", value: 30 });
  });

  it("respects concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const items = Array.from({ length: 8 }, (_, i) => i);
    await mapSettledWithConcurrency(items, 2, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(10);
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("throws when concurrency is less than 1", async () => {
    await expect(
      mapSettledWithConcurrency([1, 2, 3], 0, async (x) => x),
    ).rejects.toThrow("concurrency must be a positive integer");
  });

  it("throws when concurrency is non-integer", async () => {
    await expect(
      mapSettledWithConcurrency([1, 2, 3], 2.2, async (x) => x),
    ).rejects.toThrow("concurrency must be a positive integer");
  });
});
