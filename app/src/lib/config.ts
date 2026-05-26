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
    groqModel: env("GROQ_MODEL", "llama-3.1-8b-instant"),
  },

  extractionDocs: path.resolve(appRoot, env("EXTRACTION_DOCS", "../extraction/docs")),
  poolSize: parseInt(env("POOL_SIZE", "50"), 10),

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
