/**
 * Central configuration, read once from environment variables.
 * Every external dependency (DB path, LLM provider) is resolved here so the
 * rest of the app never touches process.env directly.
 */
import path from "path";

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v;
}

const appRoot = process.cwd();

export const config = {
  appRoot,
  databasePath: path.resolve(
    appRoot,
    env("DATABASE_PATH", "./data/cat.db"),
  ),
  sessionSecret: env("SESSION_SECRET", "dev-insecure-secret-change-me"),
  sessionTtlDays: 7,

  admin: {
    username: env("ADMIN_USERNAME", "admin"),
    // password is only read by the init-db seed script, never at runtime
    password: process.env.ADMIN_PASSWORD || "",
  },

  llm: {
    provider: env("LLM_PROVIDER", "ollama") as "ollama" | "groq",
    ollamaUrl: env("OLLAMA_URL", "http://localhost:11434"),
    ollamaModel: env("OLLAMA_MODEL", "qwen2.5:7b-instruct"),
    ollamaEmbedModel: env("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
    groqApiKey: process.env.GROQ_API_KEY || "",
    // One or more Groq API keys. Set GROQ_API_KEYS="key1,key2,key3" to spread
    // load across keys (round-robin) and fail over on 429 — this multiplies the
    // effective free-tier tokens-per-minute budget. Falls back to GROQ_API_KEY.
    groqApiKeys: (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    groqModel: env("GROQ_MODEL", "llama-3.1-8b-instant"),
    // The judge is a SECOND model used to score freshly generated sets.
    // Should be a different family from the writer for genuine second-opinion.
    judgeModel: env("JUDGE_MODEL", "qwen/qwen3-32b"),
  },

  extractionDocs: path.resolve(appRoot, env("EXTRACTION_DOCS", "../extraction/docs")),
  poolSize: parseInt(env("POOL_SIZE", "50"), 10),
  /** Maximum quality-graded sets the cron will hold per section. Target 50+
   * so a user practically never exhausts the unseen pool (= no repeats). */
  poolTarget: parseInt(env("POOL_TARGET", "50"), 10),
  /** Maximum sets the cron tries to generate per single invocation.
   * Vercel Hobby caps a single function call at 300s; a single set takes
   * 60-200s including the judge. Default 1 keeps each tick safely under
   * the limit. Increase to 2-3 only if you're on Vercel Pro. */
  maxPerTick: parseInt(env("MAX_PER_TICK", "1"), 10),
  /** Which sections the cron is allowed to top up. VA and QA fire 5-10
   * LLM calls per set and routinely exceed Vercel Hobby's 300s function
   * cap, so by default the cron leaves them out — they generate on-demand
   * when the user clicks Generate. Add VA/QA only on Vercel Pro or when
   * the worker runs off-platform. */
  cronSections: env("CRON_SECTIONS", "VA,RC,DI,LR,QA")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  /** Minimum judge score across dimensions; below this the set is rejected. */
  minQuality: parseInt(env("MIN_QUALITY", "6"), 10),
  /** Pooled sets older than this many hours are deleted by the cleaner —
   * but only if no user has an attempt referencing them. Set to 0 to disable. */
  cleanupMaxAgeHours: parseInt(env("CLEANUP_MAX_AGE_HOURS", "72"), 10),
  /** Maximum rows the cleaner deletes per cron tick (bounds the work). */
  cleanupMaxRows: parseInt(env("CLEANUP_MAX_ROWS", "200"), 10),

  appUrl: env("APP_URL", "http://localhost:3000"),
  workerToken: env("WORKER_TOKEN", "dev-insecure-worker-token"),
} as const;

/** The five practice sections. */
export const SECTIONS = ["VA", "RC", "DI", "LR", "QA"] as const;
export type Section = (typeof SECTIONS)[number];

/** How many items a single generated set contains, per section. */
export const SET_SHAPE: Record<Section, string> = {
  VA: "10 questions (mix of para-completion, para-jumble, odd-one-out, summary)",
  RC: "2 passages, 4 questions each",
  DI: "2 data-interpretation sets",
  LR: "2 logical-reasoning sets",
  QA: "10 questions (mix of geometry, algebra, arithmetic, modern math, misc)",
};
