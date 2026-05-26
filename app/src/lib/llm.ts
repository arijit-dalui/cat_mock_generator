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

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  system?: string;
}

const TIMEOUT_MS = 900_000; // 15 min hard cap per LLM call

/** Plain node:http(s) POST. Avoids fetch/undici body-timeout defaults that
 * would abort slow CPU-LLM responses. Returns the raw body as text. */
function rawPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
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

// ---- Ollama (local) -------------------------------------------------------
async function ollamaChat(prompt: string, opts: ChatOptions): Promise<string> {
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const { status, body } = await rawPost(
    `${config.llm.ollamaUrl}/api/chat`,
    JSON.stringify({
      model: config.llm.ollamaModel,
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
async function groqChat(prompt: string, opts: ChatOptions): Promise<string> {
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const { status, body } = await rawPost(
    "https://api.groq.com/openai/v1/chat/completions",
    JSON.stringify({
      model: config.llm.groqModel,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
      response_format: { type: "json_object" },
    }),
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llm.groqApiKey}`,
    },
  );
  if (status < 200 || status >= 300)
    throw new Error(`Groq chat failed: ${status}`);
  const data = JSON.parse(body);
  return data?.choices?.[0]?.message?.content ?? "";
}

/** Send a prompt to the active provider, with one retry. */
export async function chat(prompt: string, opts: ChatOptions = {}): Promise<string> {
  const fn = config.llm.provider === "groq" ? groqChat : ollamaChat;
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

/** Escape raw control characters inside JSON string literals so JSON.parse
 * won't reject the payload. LLMs frequently emit literal newlines/tabs in
 * "context" / "prompt" / "solution" fields. */
function sanitiseJsonControlChars(src: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const code = src.charCodeAt(i);
    if (inStr) {
      if (esc) {
        out += c;
        esc = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        esc = true;
        continue;
      }
      if (c === '"') {
        out += c;
        inStr = false;
        continue;
      }
      if (code === 0x0a) {
        out += "\\n";
        continue;
      }
      if (code === 0x0d) {
        out += "\\r";
        continue;
      }
      if (code === 0x09) {
        out += "\\t";
        continue;
      }
      if (code < 0x20) {
        out += " ";
        continue;
      }
      out += c;
      continue;
    }
    if (c === '"') {
      inStr = true;
    }
    out += c;
  }
  return out;
}

/** Pull the first balanced JSON object/array out of an LLM response. */
export function extractJSON(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const sObj = t.indexOf("{");
  const sArr = t.indexOf("[");
  const candidates = [sObj, sArr].filter((i) => i >= 0);
  if (!candidates.length) throw new Error("No JSON found in LLM response");
  const start = Math.min(...candidates);
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        const slice = t.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          // Retry after escaping raw control chars in string literals.
          return JSON.parse(sanitiseJsonControlChars(slice));
        }
      }
    }
  }
  throw new Error("Unbalanced JSON in LLM response");
}

/** Chat call that expects and returns parsed JSON. */
export async function chatJSON<T = unknown>(
  prompt: string,
  opts: ChatOptions = {},
): Promise<T> {
  const system =
    (opts.system ? opts.system + "\n" : "") +
    "Respond with valid JSON only. No markdown, no commentary.";
  const raw = await chat(prompt, { ...opts, system });
  return extractJSON(raw) as T;
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
