/**
 * Live test: parse a short document through OpenRouter and validate the result.
 *
 * Usage: npx tsx scripts/test-parse-live.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local manually
const envPath = resolve(import.meta.dirname!, "..", ".env.local");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const m = line.match(/^(\w+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

import { buildParseSystemPrompt, buildParseUserMessage } from "../src/prompts/parse-document";
import { callOpenRouter } from "../src/openrouter";
import { parseCorpusContent, chunkCorpus } from "../src/content-helpers";
import { injectWatermark } from "../src/watermark";

// Short but real compliance text (~300 words)
const SOURCE_TEXT = `
NIST SP 800-53 Rev. 5 — Access Control (AC) Family (Excerpt)

AC-1: Policy and Procedures
Organizations must develop, document, and disseminate access control policies that address purpose, scope, roles, responsibilities, and compliance. Procedures must facilitate the implementation of access control policy. Policies and procedures must be reviewed and updated at least annually or when significant changes occur.

AC-2: Account Management
Organizations must manage information system accounts including identifying account types, establishing conditions for group and role membership, assigning account managers, and requiring appropriate approvals for account creation. Accounts must be reviewed at least annually. Temporary and emergency accounts must have automatic expiration.

AC-3: Access Enforcement
The information system must enforce approved authorizations for logical access to information and system resources in accordance with applicable access control policies. Access enforcement mechanisms include access control lists, access control matrices, and cryptography.

AC-6: Least Privilege
Organizations must employ the principle of least privilege, allowing only authorized accesses for users which are necessary to accomplish assigned organizational tasks. Privileged accounts must be restricted to specific personnel. Auditing of privileged functions must be enabled.

AC-17: Remote Access
Organizations must establish and document usage restrictions and implementation guidance for each type of remote access allowed. Remote access must be authorized before connection. All remote access sessions must be encrypted using FIPS-validated cryptography.
`.trim();

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENROUTER_API_KEY");
    process.exit(1);
  }

  const model = "anthropic/claude-sonnet-4.6";

  console.log("=== LIVE PARSE TEST ===");
  console.log(`Model: ${model}`);
  console.log(`Source: ${SOURCE_TEXT.split(/\s+/).length} words\n`);

  // Build prompts
  const systemPrompt = buildParseSystemPrompt(model);
  const userMessage = buildParseUserMessage(SOURCE_TEXT, "nist-sp-800-53-ac.txt");

  console.log("--- Calling OpenRouter...");
  const start = Date.now();

  const result = await callOpenRouter(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    { apiKey, model },
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`--- Done in ${elapsed}s (${result.inputTokens} in / ${result.outputTokens} out)\n`);

  // Extract markdown from code fence
  const fenceMatch = result.content.match(/```(?:markdown)?\s*\n([\s\S]*)\n\s*```\s*$/);
  const extracted = fenceMatch ? fenceMatch[1].trim() : result.content.trim();

  console.log("=== RAW EXTRACTED MARKDOWN ===");
  console.log(extracted);
  console.log(`\n=== LENGTH: ${extracted.length} chars, ${extracted.split(/\s+/).length} words ===\n`);

  // Check for body content after frontmatter
  const fmEnd = extracted.lastIndexOf("---");
  const body = extracted.slice(fmEnd + 3).trim();
  console.log(`=== BODY (after frontmatter): ${body.length} chars ===`);
  console.log(body.slice(0, 200) + (body.length > 200 ? "..." : ""));
  console.log();

  // Validate
  try {
    const corpus = parseCorpusContent(extracted);
    console.log("=== VALIDATION: PASSED ===");
    console.log(`  corpus_id: ${corpus.corpus_id}`);
    console.log(`  title: ${corpus.title}`);
    console.log(`  tier: ${corpus.tier}`);
    console.log(`  frameworks: ${JSON.stringify(corpus.frameworks)}`);
    console.log(`  sire.subject: ${corpus.sire?.subject}`);
    console.log(`  sire.excluded: ${JSON.stringify(corpus.sire?.excluded)}`);
    console.log(`  body length: ${corpus.content.length} chars`);
    console.log(`  has ## headings: ${/^##\s/m.test(corpus.content)}`);

    // Chunk
    const chunks = chunkCorpus(corpus);
    console.log(`\n=== CHUNKING: ${chunks.length} chunks ===`);
    for (const chunk of chunks) {
      console.log(`  [${chunk.sequence}] "${chunk.section_title}" — ${chunk.token_count} tokens`);
    }

    // Watermark
    const watermarked = chunks.map((chunk) => ({
      ...chunk,
      content: injectWatermark(chunk.content, {
        corpusId: corpus.corpus_id,
        sequence: chunk.sequence,
        contentHash: chunk.content_hash,
      }),
    }));
    console.log(`\n=== WATERMARK: ${watermarked.length} chunks watermarked ===`);
    // Show first watermark line
    const firstWm = watermarked[0]?.content.split("\n").find((l: string) => l.includes("<!--"));
    if (firstWm) console.log(`  Sample: ${firstWm.trim()}`);

    console.log("\n=== FULL PIPELINE: SUCCESS ===");
  } catch (err) {
    console.error("=== VALIDATION: FAILED ===");
    console.error(err instanceof Error ? err.message : err);
    console.log("\n=== RAW AI OUTPUT (for debugging) ===");
    console.log(result.content.slice(0, 500));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
