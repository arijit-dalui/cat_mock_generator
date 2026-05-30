/**
 * Postgres data-access layer (used in cloud deployments via DATABASE_URL).
 * Mirrors the shape of db-sqlite.ts but every method is async.
 *
 * The schema is applied on first use; safe because every CREATE is IF NOT EXISTS.
 */
import postgres from "postgres";
import type { Sql } from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __catSql: Sql | undefined;
  // eslint-disable-next-line no-var
  var __catSchemaApplied: boolean | undefined;
}

function client(): Sql {
  if (global.__catSql) return global.__catSql;
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, {
    ssl: "require",
    max: 5,
    idle_timeout: 30,
    connect_timeout: 30,
  });
  if (process.env.NODE_ENV !== "production") global.__catSql = sql;
  return sql;
}

export const sql = client();

/** Schema is normally applied by `npm run init-db`. On serverless we may
 * still hit a fresh DB once - this is a quick idempotent safety net. */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL, section TEXT, meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE TABLE IF NOT EXISTS kb_items (
  id SERIAL PRIMARY KEY, section TEXT NOT NULL, subtype TEXT,
  source_file TEXT, stem TEXT, options JSONB, answer TEXT,
  solution TEXT, difficulty TEXT, word_count INTEGER, embedding JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_section ON kb_items(section, subtype);
CREATE TABLE IF NOT EXISTS generated_sets (
  id SERIAL PRIMARY KEY, section TEXT NOT NULL, payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pooled', created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  quality_score INTEGER, judge_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_sets_section_status ON generated_sets(section, status);
CREATE INDEX IF NOT EXISTS idx_sets_section_quality
  ON generated_sets(section, quality_score DESC, created_at DESC);
-- Migrations for existing deploys (Postgres allows IF NOT EXISTS on ADD COLUMN since 9.6).
ALTER TABLE generated_sets ADD COLUMN IF NOT EXISTS quality_score INTEGER;
ALTER TABLE generated_sets ADD COLUMN IF NOT EXISTS judge_notes TEXT;
CREATE TABLE IF NOT EXISTS user_seen_sets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id  INTEGER NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, set_id)
);
CREATE INDEX IF NOT EXISTS idx_user_seen_user ON user_seen_sets(user_id);
CREATE TABLE IF NOT EXISTS attempts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id INTEGER NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  section TEXT NOT NULL, answers JSONB, score REAL, total INTEGER,
  submitted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, section);
`;

async function ensureSchema(): Promise<void> {
  if (global.__catSchemaApplied) return;
  await sql.unsafe(SCHEMA_SQL);
  global.__catSchemaApplied = true;
}

// Apply schema lazily on first query.
const ready = ensureSchema();

// ---- types (parallel to db-sqlite.ts) ------------------------------------
export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: "user" | "admin";
  created_at: string;
}

export interface SessionRow {
  token: string;
  user_id: number;
  created_at: string;
  expires_at: string;
}

export interface GeneratedSet {
  id: number;
  section: string;
  payload: string; // JSON string (we serialise on insert, parse on read for compatibility)
  status: "pooled" | "served";
  created_by: string | null;
  created_at: string;
}

export interface Attempt {
  id: number;
  user_id: number;
  set_id: number;
  section: string;
  answers: string | null;
  score: number | null;
  total: number | null;
  submitted: number;
  created_at: string;
  submitted_at: string | null;
}

function isoize(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}

// ---- users ---------------------------------------------------------------
export const users = {
  async byUsername(username: string): Promise<User | undefined> {
    await ready;
    const rows = await sql<User[]>`SELECT * FROM users WHERE username = ${username}`;
    return rows[0];
  },
  async byId(id: number): Promise<User | undefined> {
    await ready;
    const rows = await sql<User[]>`SELECT * FROM users WHERE id = ${id}`;
    return rows[0];
  },
  async create(
    username: string,
    passwordHash: string,
    role: "user" | "admin" = "user",
  ): Promise<User> {
    await ready;
    const rows = await sql<
      User[]
    >`INSERT INTO users (username, password_hash, role) VALUES (${username}, ${passwordHash}, ${role}) RETURNING *`;
    return rows[0];
  },
  async count(): Promise<number> {
    await ready;
    const rows = await sql<{ c: number }[]>`SELECT COUNT(*)::int c FROM users`;
    return rows[0].c;
  },
};

// ---- sessions ------------------------------------------------------------
export const sessions = {
  async create(token: string, userId: number, expiresAt: string): Promise<void> {
    await ready;
    await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expiresAt})`;
  },
  async get(token: string): Promise<SessionRow | undefined> {
    await ready;
    const rows = await sql<
      SessionRow[]
    >`SELECT token, user_id, created_at::text, expires_at::text FROM sessions WHERE token = ${token}`;
    return rows[0];
  },
  async destroy(token: string): Promise<void> {
    await ready;
    await sql`DELETE FROM sessions WHERE token = ${token}`;
  },
  async purgeExpired(): Promise<void> {
    await ready;
    await sql`DELETE FROM sessions WHERE expires_at < now()`;
  },
};

// ---- events --------------------------------------------------------------
export const events = {
  async log(
    type: string,
    userId: number | null,
    section?: string | null,
    meta?: unknown,
  ): Promise<void> {
    await ready;
    await sql`INSERT INTO events (user_id, type, section, meta) VALUES (${userId}, ${type}, ${section ?? null}, ${meta ? sql.json(meta as Parameters<typeof sql.json>[0]) : null})`;
  },
};

// ---- generated sets ------------------------------------------------------
export const sets = {
  async insert(section: string, payload: unknown, createdBy: string): Promise<number> {
    await ready;
    const rows = await sql<
      { id: number }[]
    >`INSERT INTO generated_sets (section, payload, created_by) VALUES (${section}, ${sql.json(payload as Parameters<typeof sql.json>[0])}, ${createdBy}) RETURNING id`;
    return rows[0].id;
  },
  async takeFromPool(section: string): Promise<GeneratedSet | undefined> {
    await ready;
    // Atomic claim: SELECT ... FOR UPDATE SKIP LOCKED would be ideal but
    // postgres.js doesn't expose explicit transactions tersely; do it in two
    // statements and tolerate the rare race.
    const rows = await sql<
      GeneratedSet[]
    >`SELECT id, section, payload::text AS payload, status, created_by, created_at::text
        FROM generated_sets
        WHERE section = ${section} AND status = 'pooled'
        ORDER BY created_at LIMIT 1`;
    const row = rows[0];
    if (!row) return undefined;
    const updated = await sql<
      { id: number }[]
    >`UPDATE generated_sets SET status = 'served' WHERE id = ${row.id} AND status = 'pooled' RETURNING id`;
    if (updated.length === 0) return undefined; // lost the race
    return row;
  },
  async byId(id: number): Promise<GeneratedSet | undefined> {
    await ready;
    const rows = await sql<
      GeneratedSet[]
    >`SELECT id, section, payload::text AS payload, status, created_by, created_at::text
        FROM generated_sets WHERE id = ${id}`;
    return rows[0];
  },
  async poolCount(section: string): Promise<number> {
    await ready;
    const rows = await sql<
      { c: number }[]
    >`SELECT COUNT(*)::int c FROM generated_sets WHERE section = ${section} AND status = 'pooled'`;
    return rows[0].c;
  },
  async markServed(id: number): Promise<void> {
    await ready;
    await sql`UPDATE generated_sets SET status = 'served' WHERE id = ${id}`;
  },
  /** Insert a freshly generated set with judge quality score. */
  async insertWithQuality(
    section: string,
    payload: unknown,
    createdBy: string,
    qualityScore: number,
    judgeNotes: string,
  ): Promise<number> {
    await ready;
    const rows = await sql<
      { id: number }[]
    >`INSERT INTO generated_sets (section, payload, created_by, quality_score, judge_notes)
        VALUES (${section}, ${sql.json(payload as Parameters<typeof sql.json>[0])}, ${createdBy}, ${qualityScore}, ${judgeNotes})
        RETURNING id`;
    return rows[0].id;
  },
  /** Highest-quality pooled set in `section` that this user has NOT yet seen,
   * or undefined when they've seen them all. The caller should generate a
   * fresh set when this returns undefined rather than re-serving a stale one
   * (re-serving was the "same set again and again" bug). */
  async pickForUser(
    section: string,
    userId: number,
  ): Promise<GeneratedSet | undefined> {
    await ready;
    // Only serve JUDGE-GRADED sets (quality_score IS NOT NULL). Legacy
    // pre-grading rows (NULL score) carry the old wrong/off-by-one keys, so we
    // never pick them — exhausting graded sets triggers fresh generation in the
    // route instead. Their review links stay valid; they're just never served.
    const fresh = await sql<
      GeneratedSet[]
    >`SELECT g.id, g.section, g.payload::text AS payload, g.status, g.created_by, g.created_at::text
        FROM generated_sets g
        WHERE g.section = ${section}
          AND g.quality_score IS NOT NULL
          AND g.id NOT IN (
            SELECT set_id FROM user_seen_sets WHERE user_id = ${userId}
          )
        ORDER BY g.quality_score DESC, g.created_at DESC
        LIMIT 1`;
    return fresh[0];
  },
  /** Last-resort fallback: the set this user saw longest ago. Only used when
   * the pool is exhausted AND fresh generation failed, so the user is never
   * handed an error while some content exists. */
  async pickSeenLRU(
    section: string,
    userId: number,
  ): Promise<GeneratedSet | undefined> {
    await ready;
    const seen = await sql<
      GeneratedSet[]
    >`SELECT g.id, g.section, g.payload::text AS payload, g.status, g.created_by, g.created_at::text
        FROM generated_sets g
        JOIN user_seen_sets s ON s.set_id = g.id
        WHERE g.section = ${section} AND s.user_id = ${userId}
        ORDER BY s.seen_at ASC
        LIMIT 1`;
    return seen[0];
  },
  /** Count of pooled sets in this section that have a judge score (i.e. the
   * new-style pool, not legacy 'served' rows). */
  async qualityPoolCount(section: string): Promise<number> {
    await ready;
    const rows = await sql<
      { c: number }[]
    >`SELECT COUNT(*)::int c FROM generated_sets WHERE section = ${section} AND quality_score IS NOT NULL`;
    return rows[0].c;
  },
  /** Delete sets older than maxAgeHours that are NOT referenced by any
   * attempt (so we never break a user's review-mode link). Capped at
   * maxRows per call so a single cron tick is bounded. */
  async cleanupOld(maxAgeHours: number, maxRows: number): Promise<number> {
    await ready;
    if (maxAgeHours <= 0) return 0;
    const rows = await sql<
      { id: number }[]
    >`DELETE FROM generated_sets
        WHERE id IN (
          SELECT g.id FROM generated_sets g
            LEFT JOIN attempts a ON a.set_id = g.id
            WHERE g.created_at < now() - (${maxAgeHours} || ' hours')::interval
              AND a.id IS NULL
            ORDER BY g.created_at ASC
            LIMIT ${maxRows}
        )
        RETURNING id`;
    return rows.length;
  },
  /** Delete every pooled set that no attempt references. Used as a one-shot
   * reset to clear stale/wrong-key content; review links survive because any
   * set tied to a real attempt is kept. Returns the number deleted. */
  async purgeUnreferenced(): Promise<number> {
    await ready;
    const rows = await sql<
      { id: number }[]
    >`DELETE FROM generated_sets g
        WHERE NOT EXISTS (SELECT 1 FROM attempts a WHERE a.set_id = g.id)
        RETURNING g.id`;
    return rows.length;
  },
};

// ---- user_seen_sets ------------------------------------------------------
export const userSeen = {
  async mark(userId: number, setId: number): Promise<void> {
    await ready;
    await sql`INSERT INTO user_seen_sets (user_id, set_id) VALUES (${userId}, ${setId})
      ON CONFLICT (user_id, set_id) DO NOTHING`;
  },
};

// ---- attempts ------------------------------------------------------------
export const attempts = {
  async create(userId: number, setId: number, section: string): Promise<number> {
    await ready;
    const rows = await sql<
      { id: number }[]
    >`INSERT INTO attempts (user_id, set_id, section) VALUES (${userId}, ${setId}, ${section}) RETURNING id`;
    return rows[0].id;
  },
  async byId(id: number): Promise<Attempt | undefined> {
    await ready;
    const rows = await sql<
      Attempt[]
    >`SELECT id, user_id, set_id, section,
              answers::text AS answers,
              score, total,
              (submitted)::int AS submitted,
              created_at::text,
              submitted_at::text
        FROM attempts WHERE id = ${id}`;
    return rows[0];
  },
  async listForUser(userId: number, section?: string): Promise<Attempt[]> {
    await ready;
    if (section) {
      return await sql<
        Attempt[]
      >`SELECT id, user_id, set_id, section, answers::text AS answers, score, total,
                (submitted)::int AS submitted, created_at::text, submitted_at::text
          FROM attempts WHERE user_id = ${userId} AND section = ${section}
          ORDER BY created_at DESC`;
    }
    return await sql<
      Attempt[]
    >`SELECT id, user_id, set_id, section, answers::text AS answers, score, total,
              (submitted)::int AS submitted, created_at::text, submitted_at::text
        FROM attempts WHERE user_id = ${userId} ORDER BY created_at DESC`;
  },
  async submit(id: number, answers: unknown, score: number, total: number): Promise<void> {
    await ready;
    await sql`UPDATE attempts SET answers = ${sql.json(answers as Parameters<typeof sql.json>[0])}, score = ${score}, total = ${total}, submitted = TRUE, submitted_at = now() WHERE id = ${id}`;
  },
};

/** Raw SQL escape hatch (used by admin stats and KB code). */
export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready;
  return (await sql.unsafe(text, params as never[])) as T[];
}
