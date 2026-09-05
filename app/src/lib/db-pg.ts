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
  social_links TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_links TEXT;
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
CREATE TABLE IF NOT EXISTS mocks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submitted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mocks_user ON mocks(user_id);
CREATE TABLE IF NOT EXISTS attempts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id INTEGER NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  section TEXT NOT NULL, answers JSONB, score REAL, total INTEGER,
  raw_score REAL,
  mock_id INTEGER REFERENCES mocks(id) ON DELETE CASCADE,
  phase TEXT,
  submitted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, section);
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS raw_score REAL;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS mock_id INTEGER REFERENCES mocks(id) ON DELETE CASCADE;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS phase TEXT;
-- These indexes must come AFTER the ALTERs above - on an existing (pre-mock)
-- database the columns don't exist until those ALTERs run, and an index on
-- a missing column errors, aborting this whole multi-statement batch.
CREATE INDEX IF NOT EXISTS idx_attempts_mock ON attempts(mock_id);
CREATE INDEX IF NOT EXISTS idx_attempts_section_submitted ON attempts(section, submitted);
CREATE TABLE IF NOT EXISTS user_external_stats (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section TEXT NOT NULL, solved INTEGER NOT NULL DEFAULT 0, accuracy REAL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, section)
);
CREATE TABLE IF NOT EXISTS question_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id INTEGER REFERENCES attempts(id) ON DELETE SET NULL,
  set_id INTEGER,
  question_id TEXT NOT NULL,
  section TEXT NOT NULL,
  prompt_snapshot TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_question_reports_status ON question_reports(status, created_at);
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
  social_links: string | null;
  created_at: string;
}

export interface LeaderboardRow {
  username: string;
  best_score: number;
  created_at: string | null;
  submitted_at: string | null;
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
  raw_score: number | null;
  mock_id: number | null;
  phase: string | null;
  submitted: number;
  created_at: string;
  submitted_at: string | null;
}

/** A row of the admin set-browser (payload kept as a JSON string). */
export interface PagedSet {
  id: number;
  section: string;
  payload: string;
  status: string;
  quality_score: number | null;
  judge_notes: string | null;
  created_at: string;
}

/** Per-section aggregate of a user's submitted attempts. */
export interface SectionStat {
  section: string;
  attempts: number;
  solved: number;
  correct: number;
}

/** A user's self-reported practice from outside this app. */
export interface ExternalStat {
  section: string;
  solved: number;
  accuracy: number | null;
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
  async listAll(): Promise<User[]> {
    await ready;
    return await sql<User[]>`SELECT * FROM users ORDER BY created_at DESC`;
  },
  /** Admin-mediated password reset - there's no email/SMTP in this app, so
   * self-service "forgot password" isn't securely possible; an admin sets
   * a new password for the user directly instead. */
  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await ready;
    await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`;
  },
  /** Self-entered profile links (Reddit, Instagram, ...) - never an OAuth
   * connection, just a URL the user typed in, shown on their public
   * profile. */
  async updateSocialLinks(id: number, links: unknown): Promise<void> {
    await ready;
    await sql`UPDATE users SET social_links = ${JSON.stringify(links)} WHERE id = ${id}`;
  },
  /** Top scorers in a section, by each user's own best raw_score. Real
   * data only - empty until people have actually submitted attempts. */
  async leaderboard(section: string, limit = 10): Promise<LeaderboardRow[]> {
    await ready;
    const rows = await sql<LeaderboardRow[]>`
      SELECT DISTINCT ON (u.id)
             u.username AS username, a.raw_score AS best_score,
             a.created_at::text AS created_at, a.submitted_at::text AS submitted_at
        FROM attempts a JOIN users u ON u.id = a.user_id
       WHERE a.section = ${section} AND a.submitted = TRUE AND a.raw_score IS NOT NULL
       ORDER BY u.id, a.raw_score DESC`;
    return rows.sort((a, b) => b.best_score - a.best_score).slice(0, limit);
  },
  /** Top N by best full-mock total (summed raw_score across a mock's five
   * section attempts) - real submitted mocks only. `created_at`/
   * `submitted_at` are the mock's own timestamps, so the UI can show how
   * long that sitting took. */
  async mockLeaderboard(limit = 10): Promise<LeaderboardRow[]> {
    await ready;
    const rows = await sql<{ user_id: number; username: string; total_score: number; created_at: string; submitted_at: string }[]>`
      WITH mock_totals AS (
        SELECT m.id AS mock_id, m.user_id, m.created_at, m.submitted_at, SUM(a.raw_score) AS total_score
          FROM mocks m JOIN attempts a ON a.mock_id = m.id
         WHERE m.submitted = TRUE
         GROUP BY m.id
      )
      SELECT DISTINCT ON (mt.user_id)
             mt.user_id AS user_id, u.username AS username, mt.total_score AS total_score,
             mt.created_at::text AS created_at, mt.submitted_at::text AS submitted_at
        FROM mock_totals mt JOIN users u ON u.id = mt.user_id
       ORDER BY mt.user_id, mt.total_score DESC`;
    return rows
      .sort((a, b) => b.total_score - a.total_score)
      .slice(0, limit)
      .map((r) => ({ username: r.username, best_score: r.total_score, created_at: r.created_at, submitted_at: r.submitted_at }));
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
  /** The judge's own rejection notes from the last few attempts in this
   * section, most recent first - fed back into the next generation prompt
   * as "don't repeat these mistakes" instead of starting from zero every
   * time. */
  async recentRejectionNotes(section: string, limit = 3): Promise<string[]> {
    await ready;
    const rows = await sql<{ meta: { notes?: string } | null }[]>`
      SELECT meta FROM events
       WHERE type = 'gen_reject' AND section = ${section}
       ORDER BY id DESC LIMIT ${limit}`;
    return rows
      .map((r) => r.meta?.notes ?? null)
      .filter((n): n is string => !!n && n.trim().length > 0);
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
  async updatePayload(id: number, payload: unknown): Promise<void> {
    await ready;
    // payload is a JSONB column: use sql.json so it stores a JSON object, not a
    // JSON string scalar. (JSON.stringify here would double-encode it, so
    // payload::text would read back as a quoted string — a blank practice page.)
    await sql`UPDATE generated_sets SET payload = ${sql.json(
      payload as Parameters<typeof sql.json>[0],
    )} WHERE id = ${id}`;
  },
  /** Insert a freshly generated set with judge quality score. */
  /** Inserts as 'pending' - judge-accepted, but not yet servable to real
   * users until an admin approves it on the Question sets review page. */
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
    >`INSERT INTO generated_sets (section, payload, created_by, quality_score, judge_notes, status)
        VALUES (${section}, ${sql.json(payload as Parameters<typeof sql.json>[0])}, ${createdBy}, ${qualityScore}, ${judgeNotes}, 'pending')
        RETURNING id`;
    return rows[0].id;
  },
  /** Admin approval: moves a reviewed 'pending' set into the live pool. */
  async approve(id: number): Promise<void> {
    await ready;
    await sql`UPDATE generated_sets SET status = 'pooled' WHERE id = ${id} AND status = 'pending'`;
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
          AND g.status = 'pooled'
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
  /** Admin browse: newest-first page of sets, optionally filtered by section.
   * Fetch `limit`+1 rows to let the caller detect a next page cheaply. */
  async listPaged(
    section: string | null,
    limit: number,
    offset: number,
    status?: string | null,
  ): Promise<PagedSet[]> {
    await ready;
    if (section && status) {
      return await sql<PagedSet[]>`
        SELECT id, section, payload::text AS payload, status, quality_score, judge_notes, created_at::text
          FROM generated_sets WHERE section = ${section} AND status = ${status}
          ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    }
    if (section) {
      return await sql<PagedSet[]>`
        SELECT id, section, payload::text AS payload, status, quality_score, judge_notes, created_at::text
          FROM generated_sets WHERE section = ${section}
          ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    }
    if (status) {
      return await sql<PagedSet[]>`
        SELECT id, section, payload::text AS payload, status, quality_score, judge_notes, created_at::text
          FROM generated_sets WHERE status = ${status}
          ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    }
    return await sql<PagedSet[]>`
      SELECT id, section, payload::text AS payload, status, quality_score, judge_notes, created_at::text
        FROM generated_sets
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  },
  /** Hard-delete a set. Cascades to attempts and user_seen_sets (ON DELETE CASCADE). */
  async delete(id: number): Promise<void> {
    await ready;
    await sql`DELETE FROM generated_sets WHERE id = ${id}`;
  },

  // ---- incremental draft building ----------------------------------------
  // A "draft" is a partially-built set (status='draft', quality_score NULL) so
  // it is invisible to every serving/pool query above. The pool builder fills
  // it one unit at a time, then finalizes it to a graded pooled row.
  /** Newest in-progress draft for a section, or undefined. Stale drafts older
   * than `maxAgeMinutes` are ignored (and should be purged) so a crashed build
   * never wedges the section forever. */
  async getDraft(
    section: string,
    maxAgeMinutes = 180,
  ): Promise<{ id: number; payload: string } | undefined> {
    await ready;
    const rows = await sql<{ id: number; payload: string }[]>`
      SELECT id, payload::text AS payload FROM generated_sets
        WHERE section = ${section} AND status = 'draft'
          AND created_at > now() - (${maxAgeMinutes} || ' minutes')::interval
        ORDER BY created_at DESC LIMIT 1`;
    return rows[0];
  },
  async createDraft(section: string, payload: unknown): Promise<number> {
    await ready;
    const rows = await sql<{ id: number }[]>`
      INSERT INTO generated_sets (section, payload, status, created_by)
        VALUES (${section}, ${sql.json(payload as Parameters<typeof sql.json>[0])}, 'draft', 'builder')
        RETURNING id`;
    return rows[0].id;
  },
  async updateDraft(id: number, payload: unknown): Promise<void> {
    await ready;
    await sql`UPDATE generated_sets SET payload = ${sql.json(
      payload as Parameters<typeof sql.json>[0],
    )} WHERE id = ${id} AND status = 'draft'`;
  },
  /** Promote a completed draft to a graded, servable pooled row. */
  async finalizeDraft(
    id: number,
    payload: unknown,
    qualityScore: number,
    judgeNotes: string,
  ): Promise<void> {
    await ready;
    await sql`UPDATE generated_sets
        SET payload = ${sql.json(payload as Parameters<typeof sql.json>[0])},
            status = 'pooled', quality_score = ${qualityScore}, judge_notes = ${judgeNotes}
        WHERE id = ${id} AND status = 'draft'`;
  },
  async deleteDraft(id: number): Promise<void> {
    await ready;
    await sql`DELETE FROM generated_sets WHERE id = ${id} AND status = 'draft'`;
  },
  /** Drop drafts older than `maxAgeMinutes` (housekeeping for crashed builds). */
  async purgeStaleDrafts(maxAgeMinutes = 180): Promise<void> {
    await ready;
    await sql`DELETE FROM generated_sets
        WHERE status = 'draft'
          AND created_at < now() - (${maxAgeMinutes} || ' minutes')::interval`;
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
  async create(
    userId: number,
    setId: number,
    section: string,
    extra?: { mockId?: number; phase?: string },
  ): Promise<number> {
    await ready;
    const rows = await sql<
      { id: number }[]
    >`INSERT INTO attempts (user_id, set_id, section, mock_id, phase)
      VALUES (${userId}, ${setId}, ${section}, ${extra?.mockId ?? null}, ${extra?.phase ?? null}) RETURNING id`;
    return rows[0].id;
  },
  async byId(id: number): Promise<Attempt | undefined> {
    await ready;
    const rows = await sql<
      Attempt[]
    >`SELECT id, user_id, set_id, section,
              answers::text AS answers,
              score, total, raw_score, mock_id, phase,
              (submitted)::int AS submitted,
              created_at::text,
              submitted_at::text
        FROM attempts WHERE id = ${id}`;
    return rows[0];
  },
  async byMock(mockId: number): Promise<Attempt[]> {
    await ready;
    return await sql<
      Attempt[]
    >`SELECT id, user_id, set_id, section, answers::text AS answers,
              score, total, raw_score, mock_id, phase,
              (submitted)::int AS submitted, created_at::text, submitted_at::text
        FROM attempts WHERE mock_id = ${mockId} ORDER BY id`;
  },
  async listForUser(userId: number, section?: string): Promise<Attempt[]> {
    await ready;
    if (section) {
      return await sql<
        Attempt[]
      >`SELECT id, user_id, set_id, section, answers::text AS answers, score, total, raw_score, mock_id, phase,
                (submitted)::int AS submitted, created_at::text, submitted_at::text
          FROM attempts WHERE user_id = ${userId} AND section = ${section}
          ORDER BY created_at DESC`;
    }
    return await sql<
      Attempt[]
    >`SELECT id, user_id, set_id, section, answers::text AS answers, score, total, raw_score, mock_id, phase,
              (submitted)::int AS submitted, created_at::text, submitted_at::text
        FROM attempts WHERE user_id = ${userId} ORDER BY created_at DESC`;
  },
  async submit(id: number, answers: unknown, score: number, total: number, rawScore: number): Promise<void> {
    await ready;
    await sql`UPDATE attempts SET answers = ${sql.json(answers as Parameters<typeof sql.json>[0])}, score = ${score}, total = ${total}, raw_score = ${rawScore}, submitted = TRUE, submitted_at = now() WHERE id = ${id}`;
  },
  /** This user's best raw_score per section, for their public profile card. */
  async bestScoresByUser(userId: number): Promise<{ section: string; best_score: number }[]> {
    await ready;
    return await sql<{ section: string; best_score: number }[]>`
      SELECT section, MAX(raw_score) AS best_score FROM attempts
       WHERE user_id = ${userId} AND submitted = TRUE AND raw_score IS NOT NULL
       GROUP BY section`;
  },
  /** Percentile of `rawScore` among every submitted attempt in `section`
   * (all users) - the share of attempts strictly below it. Real population
   * data; returns null (not 0) until there's more than just this one
   * attempt to compare against, so a lone user never sees a misleading
   * 100th percentile. */
  async percentile(section: string, rawScore: number): Promise<{ percentile: number; population: number } | null> {
    await ready;
    const rows = await sql<{ total: number; below: number }[]>`
      SELECT COUNT(*)::int AS total,
             SUM(CASE WHEN raw_score < ${rawScore} THEN 1 ELSE 0 END)::int AS below
        FROM attempts WHERE section = ${section} AND submitted = TRUE AND raw_score IS NOT NULL`;
    const row = rows[0];
    if (!row || row.total < 2) return null;
    return { percentile: (row.below / row.total) * 100, population: row.total };
  },
  /** Periodic autosave of in-progress answers, before submission. A no-op
   * once the attempt is submitted so a stray late autosave can't clobber
   * the final scored answers. */
  async saveDraft(id: number, answers: unknown): Promise<void> {
    await ready;
    await sql`UPDATE attempts SET answers = ${sql.json(answers as Parameters<typeof sql.json>[0])} WHERE id = ${id} AND submitted = FALSE`;
  },
  /** Per-section totals over this user's SUBMITTED attempts. */
  async statsByUser(userId: number): Promise<SectionStat[]> {
    await ready;
    return await sql<SectionStat[]>`
      SELECT section,
             COUNT(*)::int AS attempts,
             COALESCE(SUM(total), 0)::int AS solved,
             COALESCE(SUM(score), 0)::float AS correct
        FROM attempts
        WHERE user_id = ${userId} AND submitted = TRUE
        GROUP BY section`;
  },
};

export interface Mock {
  id: number;
  user_id: number;
  submitted: number;
  created_at: string;
  submitted_at: string | null;
}

// ---- mocks: full 3-phase (VARC/DILR/QA) attempts --------------------------
export const mocks = {
  async create(userId: number): Promise<number> {
    await ready;
    const rows = await sql<{ id: number }[]>`INSERT INTO mocks (user_id) VALUES (${userId}) RETURNING id`;
    return rows[0].id;
  },
  async byId(id: number): Promise<Mock | undefined> {
    await ready;
    const rows = await sql<Mock[]>`SELECT id, user_id, (submitted)::int AS submitted, created_at::text, submitted_at::text FROM mocks WHERE id = ${id}`;
    return rows[0];
  },
  async listForUser(userId: number): Promise<Mock[]> {
    await ready;
    return await sql<Mock[]>`SELECT id, user_id, (submitted)::int AS submitted, created_at::text, submitted_at::text FROM mocks WHERE user_id = ${userId} ORDER BY created_at DESC`;
  },
  async submit(id: number): Promise<void> {
    await ready;
    await sql`UPDATE mocks SET submitted = TRUE, submitted_at = now() WHERE id = ${id}`;
  },
  /** Cleans up a mock that failed to fully build (cascades to its attempts). */
  async remove(id: number): Promise<void> {
    await ready;
    await sql`DELETE FROM mocks WHERE id = ${id}`;
  },
  /** Percentile of a full-mock total (summed raw_score across its five
   * section attempts) against every OTHER submitted mock, across all
   * users. Same null-below-population-2 rule as the sectional percentile. */
  async percentile(totalRawScore: number): Promise<{ percentile: number; population: number } | null> {
    await ready;
    const rows = await sql<{ total: number; below: number }[]>`
      SELECT COUNT(*)::int AS total,
             SUM(CASE WHEN totals.total_score < ${totalRawScore} THEN 1 ELSE 0 END)::int AS below
        FROM (
          SELECT m.id, SUM(a.raw_score) AS total_score
            FROM mocks m JOIN attempts a ON a.mock_id = m.id
           WHERE m.submitted = TRUE
           GROUP BY m.id
        ) totals`;
    const row = rows[0];
    if (!row || row.total < 2) return null;
    return { percentile: (row.below / row.total) * 100, population: row.total };
  },
};

// ---- user_external_stats (self-reported, other sources) ------------------
export const externalStats = {
  async list(userId: number): Promise<ExternalStat[]> {
    await ready;
    return await sql<ExternalStat[]>`
      SELECT section, solved, accuracy FROM user_external_stats WHERE user_id = ${userId}`;
  },
  async upsert(
    userId: number,
    section: string,
    solved: number,
    accuracy: number | null,
  ): Promise<void> {
    await ready;
    await sql`
      INSERT INTO user_external_stats (user_id, section, solved, accuracy, updated_at)
        VALUES (${userId}, ${section}, ${solved}, ${accuracy}, now())
      ON CONFLICT (user_id, section)
        DO UPDATE SET solved = ${solved}, accuracy = ${accuracy}, updated_at = now()`;
  },
};

export interface QuestionReport {
  id: number;
  user_id: number;
  attempt_id: number | null;
  set_id: number | null;
  question_id: string;
  section: string;
  prompt_snapshot: string | null;
  reason: string | null;
  status: "open" | "resolved";
  created_at: string;
  resolved_at: string | null;
}

// ---- question_reports: "report this question" -> admin queue ------------
export const questionReports = {
  async create(row: {
    userId: number;
    attemptId: number | null;
    setId: number | null;
    questionId: string;
    section: string;
    promptSnapshot: string | null;
    reason: string | null;
  }): Promise<number> {
    await ready;
    const rows = await sql<{ id: number }[]>`
      INSERT INTO question_reports (user_id, attempt_id, set_id, question_id, section, prompt_snapshot, reason)
      VALUES (${row.userId}, ${row.attemptId}, ${row.setId}, ${row.questionId}, ${row.section}, ${row.promptSnapshot}, ${row.reason})
      RETURNING id`;
    return rows[0].id;
  },
  async listOpen(): Promise<QuestionReport[]> {
    await ready;
    return await sql<QuestionReport[]>`
      SELECT id, user_id, attempt_id, set_id, question_id, section, prompt_snapshot, reason,
             status, created_at::text, resolved_at::text
        FROM question_reports WHERE status = 'open' ORDER BY created_at DESC`;
  },
  async resolve(id: number): Promise<void> {
    await ready;
    await sql`UPDATE question_reports SET status = 'resolved', resolved_at = now() WHERE id = ${id}`;
  },
};

/** Raw SQL escape hatch (used by admin stats and KB code). */
export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready;
  return (await sql.unsafe(text, params as never[])) as T[];
}
