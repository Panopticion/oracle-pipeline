import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname!, "..");
const cliPath = resolve(repoRoot, "src", "cli.ts");
const tsxBin = resolve(repoRoot, "node_modules", ".bin", "tsx");

function runCli(args: string[]) {
  return spawnSync(tsxBin, [cliPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
}

describe("cli", () => {
  it("prints help", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Corpus Pipeline CLI");
    expect(result.stdout).toContain("--action <action>");
  });

  it("fails with unknown action", () => {
    const result = runCli(["--action", "not-real"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown action");
  });

  it("runs validate action for a single corpus", () => {
    const result = runCli(["--action", "validate", "--corpus", "gdpr-core-v1"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[corpus-pipeline] action=validate corpus=gdpr-core-v1");
    expect(result.stdout).toContain("gdpr-core-v1");
  });
});
