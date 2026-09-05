/**
 * LLM provider abstraction. Supports a local Ollama server and the hosted
 * Groq API (OpenAI-compatible). The rest of the app calls `chat`,
 * `chatJSON` and `embed` without knowing which provider is active, so the
 * deployment can switch by changing LLM_PROVIDER in .env.
 */
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { config } from "./config";
import { extractJSON } from "./jsonExtract";

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  system?: string;
  /** Optional per-call model override (defaults to config.llm.groqModel /
   * config.llm.ollamaModel). Used by the judge to invoke a different model. */
  model?: string;
}

const TIMEOUT_MS = 900_000; // 15 min hard cap per LLM call

/** Plain node:http(s) POST. Avoids fetch/undici body-timeout defaults that
 * would abort slow CPU-LLM responses. Returns the raw body as text. */
interface RawResp {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function rawPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<RawResp> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          }),
        );
        res.on("error", reject);
      },
    );
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error("LLM request timed out"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse Retry-After header (seconds or HTTP-date) into milliseconds. */
function retryAfterMs(headers: Record<string, string | string[] | undefined>): number {
  const ra = headers["retry-after"];
  const v = Array.isArray(ra) ? ra[0] : ra;
  if (!v) return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n) * 1000;
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
  return 0;
}

// ---- Ollama (local) -------------------------------------------------------
async function ollamaChat(prompt: string, opts: ChatOptions): Promise<string> {
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const { status, body } = await rawPost(
    `${config.llm.ollamaUrl}/api/chat`,
    JSON.stringify({
      model: opts.model ?? config.llm.ollamaModel,
      messages,
      stream: false,
      format: "json",
      options: {
        temperature: opts.temperature ?? 0.7,
        num_ctx: 8192,
      },
    }),
    { "Content-Type": "application/json" },
  );
  if (status < 200 || status >= 300)
    throw new Error(`Ollama chat failed: ${status}`);
  const data = JSON.parse(body);
  return data?.message?.content ?? "";
}

// ---- Groq (hosted) --------------------------------------------------------
// Round-robin cursor across the configured API keys. Module-level so every
// call (across the whole process) advances it, spreading load evenly.
let groqKeyCursor = 0;

async function groqChat(prompt: string, opts: ChatOptions): Promise<string> {
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const payload = JSON.stringify({
    model: opts.model ?? config.llm.groqModel,
    messages,
    temperature: opts.temperature ?? 0.7,
    // Cap defaults to config.llm.groqMaxTokens so prompt + max_tokens stays
    // under Groq's free-tier 6000 TPM per-request limit (8192 always 413'd).
    max_tokens: opts.maxTokens ?? config.llm.groqMaxTokens,
    response_format: { type: "json_object" },
    // gpt-oss models are reasoning models too (hidden chain-of-thought by
    // default) - confirmed this was the cause of Groq's own strict
    // json_object validator rejecting output outright (400
    // json_validate_failed, empty failed_generation) on harder prompts.
    // Ignored by non-gpt-oss Groq models.
    reasoning_effort: "low",
  });
  const keys = config.llm.groqApiKeys.length
    ? config.llm.groqApiKeys
    : [config.llm.groqApiKey];
  const url = "https://api.groq.com/openai/v1/chat/completions";

  // Strategy: on each attempt, try every key once (round-robin). A 429 on one
  // key just moves to the next key immediately — only when ALL keys are
  // rate-limited in the same round do we back off (honouring Retry-After,
  // else 5s/10s/20s). With N keys this multiplies the usable TPM budget.
  for (let attempt = 0; attempt < 4; attempt++) {
    let lastRetryAfter = 0;
    let all429 = true;
    for (let k = 0; k < keys.length; k++) {
      const key = keys[groqKeyCursor++ % keys.length];
      const { status, body, headers } = await rawPost(url, payload, {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      });
      if (status === 429) {
        lastRetryAfter = retryAfterMs(headers) || lastRetryAfter;
        continue; // try the next key right away
      }
      all429 = false;
      if (status < 200 || status >= 300)
        throw new Error(`Groq chat failed: ${status} - ${body.slice(0, 300)}`);
      const data = JSON.parse(body);
      return data?.choices?.[0]?.message?.content ?? "";
    }
    // Every key returned 429 this round — back off before the next round.
    // CAP the wait: a daily-token-cap 429 carries a huge Retry-After (e.g.
    // ~570s for the 70B model's 100K TPD). Honouring it verbatim stalls the
    // caller until ITS timeout fires (the "unit timed out after 200000ms" bug).
    // Cap at 25s so we fail fast and the caller can retry / move on instead.
    if (all429 && attempt < 3) {
      const capped = lastRetryAfter
        ? Math.min(lastRetryAfter, 25_000)
        : Math.min(20_000, 5_000 * Math.pow(2, attempt));
      await sleepMs(capped);
    }
  }
  throw new Error("Groq chat failed: 429 after retries across all keys");
}

// ---- Z.ai (hosted, OpenAI-compatible) --------------------------------------
async function zaiChat(prompt: string, opts: ChatOptions): Promise<string> {
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const payload = JSON.stringify({
    model: opts.model ?? config.llm.zaiModel,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 8000,
    response_format: { type: "json_object" },
  });
  const url = "https://api.z.ai/api/paas/v4/chat/completions";

  for (let attempt = 0; attempt < 4; attempt++) {
    const { status, body, headers } = await rawPost(url, payload, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llm.zaiApiKey}`,
    });
    if (status === 429) {
      const wait = Math.min(retryAfterMs(headers) || 5_000 * Math.pow(2, attempt), 25_000);
      if (attempt < 3) {
        await sleepMs(wait);
        continue;
      }
    }
    if (status < 200 || status >= 300)
      throw new Error(`Z.ai chat failed: ${status} - ${body.slice(0, 300)}`);
    const data = JSON.parse(body);
    return data?.choices?.[0]?.message?.content ?? "";
  }
  throw new Error("Z.ai chat failed: 429 after retries");
}

// ---- DeepSeek (hosted, OpenAI-compatible) ----------------------------------
async function deepseekChat(prompt: string, opts: ChatOptions): Promise<string> {
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const payload = JSON.stringify({
    model: opts.model ?? config.llm.deepseekModel,
    messages,
    temperature: opts.temperature ?? 0.7,
    // 4096, then 8000, then 16000 all still truncated DI/RC mid-JSON - turned
    // out to be thinking mode (see below), not a token-budget problem. Set
    // very high as a safety ceiling now that thinking is off and shouldn't
    // actually be needed, rather than something we expect to hit.
    max_tokens: opts.maxTokens ?? 200_000,
    response_format: { type: "json_object" },
    // deepseek-v4-flash runs with "thinking" mode ON by default (high
    // effort) - that's what was leaking full chain-of-thought ("wait, let
    // me recalculate...") directly into the JSON string fields, no matter
    // what the system prompt asked for. This is the actual documented
    // override, not a prompt-engineering problem.
    thinking: { type: "disabled" },
  });
  const url = "https://api.deepseek.com/chat/completions";

  for (let attempt = 0; attempt < 4; attempt++) {
    const { status, body, headers } = await rawPost(url, payload, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llm.deepseekApiKey}`,
    });
    if (status === 429) {
      const wait = Math.min(retryAfterMs(headers) || 5_000 * Math.pow(2, attempt), 25_000);
      if (attempt < 3) {
        await sleepMs(wait);
        continue;
      }
    }
    if (status < 200 || status >= 300)
      throw new Error(`DeepSeek chat failed: ${status} - ${body.slice(0, 300)}`);
    const data = JSON.parse(body);
    return data?.choices?.[0]?.message?.content ?? "";
  }
  throw new Error("DeepSeek chat failed: 429 after retries");
}

// ---- OpenRouter (hosted, OpenAI-compatible aggregator) ---------------------
async function openrouterChat(prompt: string, opts: ChatOptions): Promise<string> {
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const payload = JSON.stringify({
    model: opts.model ?? config.llm.openrouterModel,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 8000,
    response_format: { type: "json_object" },
  });
  const url = "https://openrouter.ai/api/v1/chat/completions";

  // Free-tier GLM on OpenRouter sees sustained multi-minute congestion windows
  // upstream (confirmed: a manual retry loop needed 5 attempts at 60s
  // intervals to succeed once), not brief spikes - the old 4-attempt/25s-cap
  // backoff (~35s total) gave up well before congestion cleared. 7 attempts
  // with a 30s cap (~130s total) fits inside generateSet's 260s budget.
  const MAX_ATTEMPTS = 7;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { status, body, headers } = await rawPost(url, payload, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llm.openrouterApiKey}`,
    });
    if (status === 429) {
      const wait = Math.min(retryAfterMs(headers) || 5_000 * Math.pow(2, attempt), 30_000);
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleepMs(wait);
        continue;
      }
    }
    if (status < 200 || status >= 300)
      throw new Error(`OpenRouter chat failed: ${status} - ${body.slice(0, 300)}`);
    const data = JSON.parse(body);
    const content = data?.choices?.[0]?.message?.content ?? "";
    // Confirmed via LLM_DEBUG_DUMP: the free GLM pool sometimes returns
    // HTTP 200 with an EMPTY content string when it's internally failing
    // under congestion, instead of a proper 429 - retry that too, or every
    // such response silently produces "No JSON found" with zero retries.
    if (!content.trim() && attempt < MAX_ATTEMPTS - 1) {
      await sleepMs(Math.min(5_000 * Math.pow(2, attempt), 30_000));
      continue;
    }
    return content;
  }
  throw new Error("OpenRouter chat failed: 429/empty response after retries");
}

// ---- Google Gemini (hosted, OpenAI-compatible) -----------------------------
async function geminiChat(prompt: string, opts: ChatOptions): Promise<string> {
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const payload = JSON.stringify({
    model: opts.model ?? config.llm.geminiModel,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 8000,
    response_format: { type: "json_object" },
    // gemini-3.6-flash is a "thinking" model by default: confirmed via
    // LLM_DEBUG_DUMP that it was burning most of max_tokens on internal
    // reasoning and getting cut off mid-JSON (same failure shape as
    // DeepSeek's thinking mode). "none" is rejected outright (400) - "low"
    // is the minimum accepted value on this endpoint.
    reasoning_effort: "low",
  });
  const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

  // Free tier is a tight 5 requests/minute per model - confirmed via a live
  // 429 body: {"details":[{"retryDelay":"46s"}]}. That delay is NOT an HTTP
  // header (retryAfterMs can't see it), so on a plain header-based backoff
  // we were retrying way too soon and never clearing the window. 6 attempts
  // with a 60s cap gives real 429s room to actually clear.
  const MAX_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { status, body, headers } = await rawPost(url, payload, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llm.geminiApiKey}`,
    });
    if (status === 429) {
      const bodyDelay = (() => {
        const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
        return m ? Number(m[1]) * 1000 : 0;
      })();
      const wait = Math.min(bodyDelay || retryAfterMs(headers) || 5_000 * Math.pow(2, attempt), 60_000);
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleepMs(wait);
        continue;
      }
    }
    if (status < 200 || status >= 300)
      throw new Error(`Gemini chat failed: ${status} - ${body.slice(0, 300)}`);
    const data = JSON.parse(body);
    return data?.choices?.[0]?.message?.content ?? "";
  }
  throw new Error("Gemini chat failed: 429 after retries");
}

/** Send a prompt to the active provider, with one retry. */
export async function chat(prompt: string, opts: ChatOptions = {}): Promise<string> {
  const fn =
    config.llm.provider === "groq"
      ? groqChat
      : config.llm.provider === "zai"
      ? zaiChat
      : config.llm.provider === "deepseek"
      ? deepseekChat
      : config.llm.provider === "openrouter"
      ? openrouterChat
      : config.llm.provider === "gemini"
      ? geminiChat
      : ollamaChat;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn(prompt, opts);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM request failed");
}

// Pure JSON-from-messy-text extraction lives in jsonExtract.ts (no config/env
// dependency there, so it's unit-testable standalone) - re-exported here
// since existing code imports it from "@/lib/llm".
export { extractJSON };

/** Chat call that expects and returns parsed JSON. */
export async function chatJSON<T = unknown>(
  prompt: string,
  opts: ChatOptions = {},
): Promise<T> {
  const system =
    (opts.system ? opts.system + "\n" : "") +
    "Respond with valid JSON only. No markdown, no commentary. " +
    "Every string value in the JSON must contain ONLY the final, polished " +
    "content - never your reasoning process, hesitation, or self-correction " +
    "('wait', 'let me recalculate', 'actually', 'I made a mistake', 'hmm'). " +
    "Work out the answer silently; the JSON you output is the finished " +
    "result, not a transcript of how you got there.";
  const raw = await chat(prompt, { ...opts, system });
  try {
    return extractJSON(raw) as T;
  } catch (e) {
    // TEMPORARY diagnostic: dump the raw, untruncated response so we can see
    // exactly where the JSON actually breaks, instead of guessing at
    // max_tokens numbers. Remove once the real cause is found.
    if (process.env.LLM_DEBUG_DUMP) {
      const fs = await import("node:fs/promises");
      const file = `E:/Geetesh/cat_mock_generator/app/llm-debug-${Date.now()}.txt`;
      await fs.writeFile(file, raw, "utf8").catch(() => {});
      console.error(`[chatJSON] extractJSON failed, raw response dumped to ${file} (length ${raw.length})`);
    }
    throw e;
  }
}

/** Embed text via Ollama. Returns null if embeddings are unavailable. */
export async function embed(text: string): Promise<number[] | null> {
  try {
    const { status, body } = await rawPost(
      `${config.llm.ollamaUrl}/api/embeddings`,
      JSON.stringify({
        model: config.llm.ollamaEmbedModel,
        prompt: text.slice(0, 8000),
      }),
      { "Content-Type": "application/json" },
    );
    if (status < 200 || status >= 300) return null;
    const data = JSON.parse(body);
    return Array.isArray(data?.embedding) ? data.embedding : null;
  } catch {
    return null;
  }
}

/** Cosine similarity between two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Word-overlap (Jaccard) similarity - fallback when embeddings are off. */
export function textSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const sa = norm(a);
  const sb = norm(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Quick provider health check. */
export async function llmHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const txt = await chat("Reply with the single word: ok", {
      temperature: 0,
    });
    return { ok: /ok/i.test(txt), detail: txt.slice(0, 80) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
