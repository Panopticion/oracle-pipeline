/**
 * OpenRouter chat completion client — raw HTTP fetch with retry.
 *
 * Follows the same patterns as embed.ts (exponential backoff, transient
 * error classification, no SDK dependency). Generic enough for any chat
 * completion task routed through OpenRouter.
 */

import {
  PARSE_MAX_RETRIES,
  PARSE_MODEL_DEFAULT,
  PARSE_RETRY_BASE_MS,
  TRANSIENT_STATUS_CODES,
} from "./constants";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface OpenRouterResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// ─── Retry helpers ──────────────────────────────────────────────────────────

function isTransient(status: number): boolean {
  return TRANSIENT_STATUS_CODES.includes(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(message: string): boolean {
  return (
    message.includes("fetch failed") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("UND_ERR_SOCKET")
  );
}

// ─── OpenRouter API ─────────────────────────────────────────────────────────

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Call OpenRouter chat completions API.
 *
 * Retries on transient failures (429, 5xx) with exponential backoff.
 * Non-transient errors (400, 401, 403) throw immediately.
 */
export async function callOpenRouter(
  messages: OpenRouterMessage[],
  options: OpenRouterOptions,
): Promise<OpenRouterResult> {
  const model = options.model ?? PARSE_MODEL_DEFAULT;
  const maxTokens = options.maxTokens ?? 16_384;
  const temperature = options.temperature ?? 0.1;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= PARSE_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://panopticonlabs.ai",
          "X-Title": "Panopticon Corpus Pipeline",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
        }),
      });

      // Retry on transient HTTP errors
      if (isTransient(res.status) && attempt < PARSE_MAX_RETRIES) {
        const backoff = PARSE_RETRY_BASE_MS * 2 ** attempt;
        console.warn(
          `[corpus-pipeline] OpenRouter HTTP ${String(res.status)} (attempt ${String(attempt + 1)}/${String(PARSE_MAX_RETRIES + 1)}) — retrying in ${String(backoff)}ms`,
        );
        lastError = new Error(
          `OpenRouter HTTP ${String(res.status)} (transient)`,
        );
        await sleep(backoff);
        continue;
      }

      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string; code?: string };
      };

      if (!res.ok || !body.choices?.[0]?.message?.content) {
        const msg =
          body.error?.message ?? `${String(res.status)} ${res.statusText}`;
        throw new Error(`OpenRouter completion failed: ${msg}`);
      }

      return {
        content: body.choices[0].message.content,
        model,
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Retry on network-level errors
      if (isRetryableNetworkError(message) && attempt < PARSE_MAX_RETRIES) {
        const backoff = PARSE_RETRY_BASE_MS * 2 ** attempt;
        console.warn(
          `[corpus-pipeline] OpenRouter network error (attempt ${String(attempt + 1)}/${String(PARSE_MAX_RETRIES + 1)}): ${message} — retrying in ${String(backoff)}ms`,
        );
        lastError = err instanceof Error ? err : new Error(message);
        await sleep(backoff);
        continue;
      }

      throw err;
    }
  }

  throw lastError ?? new Error("OpenRouter: max retries exceeded");
}
