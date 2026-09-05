/**
 * SQLite data-access layer (used for local development). Mirrors the shape
 * of db-pg.ts; every method is async to match the Postgres adapter, but
 * SQLite calls are synchronous internally so they resolve immediately.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config";

declare global {
  // eslint-disable-next-line no-var
  var __catDb: Database.Database | undefined;
}

function open(): Database.Database {
  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(
    path.join(config.appRoot, "src/lib/schema.sql"),
    "utf-8",
  );
  db.exec(schema);
  // CREATE TABLE IF NOT EXISTS doesn't add columns to an already-created
  // table, so a DB from before raw_score existed needs an explicit ALTER.
  // Swallow "duplicate column" once it's already there - SQLite has no
  // ADD COLUMN IF NOT EXISTS.
  try {
    db.exec("ALTER TABLE attempts ADD COLUMN raw_score REAL");
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE users ADD COLUMN social_links TEXT");
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE attempts ADD COLUMN mock_id INTEGER REFERENCES mocks(id) ON DELETE CASCADE");
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE attempts ADD COLUMN phase TEXT");
  } catch {
    /* column already exists */
  }
  // Deferred until here: an index on mock_id would throw during
  // db.exec(schema) above on any DB from before that column existed.
  db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_mock ON attempts(mock_id)");
  return db;
}

// In Postgres mode (cloud deployment) this module gets bundled by webpack but
// must never call open() - the SQLite file and schema don't exist on disk.
// We export a placeholder; the router never reaches into us in that mode.
const db: Database.Database = process.env.DATABASE_URL
  ? (null as unknown as Database.Database)
  : (global.__catDb ?? open());
if (!process.env.DATABASE_URL && process.env.NODE_ENV !== "production") {
  global.__catDb = db;
}

export { db };

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
  payload: string;
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

export const users = {
  async byUsername(username: string): Promise<User | undefined> {
    return db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username) as User | undefined;
  },
  async byId(id: number): Promise<User | undefined> {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | User
      | undefined;
  },
  async create(
    username: string,
    passwordHash: string,
    role: "user" | "admin" = "user",
  ): Promise<User> {
    const info = db
      .prepare(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
      )
      .run(username, passwordHash, role);
    return (await users.byId(Number(info.lastInsertRowid)))!;
  },
  async count(): Promise<number> {
    return (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
  },
  async listAll(): Promise<User[]> {
    return db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as User[];
  },
  /** Admin-mediated password reset - there's no email/SMTP in this app, so
   * self-service "forgot password" isn't securely possible; an admin sets
   * a new password for the user directly instead. */
  async updatePassword(id: number, passwordHash: string): Promise<void> {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  },
  /** Self-entered profile links (Reddit, Instagram, ...) - never an OAuth
   * connection, just a URL the user typed in, shown on their public
   * profile. */
  async updateSocialLinks(id: number, links: unknown): Promise<void> {
    db.prepare("UPDATE users SET social_links = ? WHERE id = ?").run(JSON.stringify(links), id);
  },
  /** Top scorers in a section, by each user's own best raw_score. Real
   * data only - empty until people have actually submitted attempts. */
  async leaderboard(section: string, limit = 10): Promise<LeaderboardRow[]> {
    return db
      .prepare(
        `SELECT username, best_score, created_at, submitted_at FROM (
           SELECT u.username AS username, a.raw_score AS best_score,
                  a.created_at AS created_at, a.submitted_at AS submitted_at,
                  ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY a.raw_score DESC) AS rn
             FROM attempts a JOIN users u ON u.id = a.user_id
            WHERE a.section = ? AND a.submitted = 1 AND a.raw_score IS NOT NULL
         )
         WHERE rn = 1
         ORDER BY best_score DESC
         LIMIT ?`,
      )
      .all(section, limit) as LeaderboardRow[];
  },
  /** Top N by best full-mock total (summed raw_score across a mock's five
   * section attempts) - real submitted mocks only. `created_at`/
   * `submitted_at` are the mock's own timestamps, so the UI can show how
   * long that sitting took. */
  async mockLeaderboard(limit = 10): Promise<LeaderboardRow[]> {
    return db
      .prepare(
        `WITH mock_totals AS (
           SELECT m.id AS mock_id, m.user_id, m.created_at AS created_at, m.submitted_at AS submitted_at,
                  SUM(a.raw_score) AS total_score
             FROM mocks m JOIN attempts a ON a.mock_id = m.id
            WHERE m.submitted = 1
            GROUP BY m.id
         ),
         ranked AS (
           SELECT user_id, total_score, created_at, submitted_at,
                  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY total_score DESC) AS rn
             FROM mock_totals
         )
         SELECT u.username AS username, r.total_score AS best_score, r.created_at AS created_at, r.submitted_at AS submitted_at
           FROM ranked r JOIN users u ON u.id = r.user_id
          WHERE r.rn = 1
          ORDER BY best_score DESC
          LIMIT ?`,
      )
      .all(limit) as LeaderboardRow[];
  },
};

export const sessions = {
  async create(token: string, userId: number, expiresAt: string): Promise<void> {
    db.prepare(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    ).run(token, userId, expiresAt);
  },
  async get(token: string): Promise<SessionRow | undefined> {
    return db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) as
      | SessionRow
      | undefined;
  },
  async destroy(token: string): Promise<void> {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  },
  async purgeExpired(): Promise<void> {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  },
};

export const events = {
  async log(
    type: string,
    userId: number | null,
    section?: string | null,
    meta?: unknown,
  ): Promise<void> {
    db.prepare(
      "INSERT INTO events (user_id, type, section, meta) VALUES (?, ?, ?, ?)",
    ).run(userId, type, section ?? null, meta ? JSON.stringify(meta) : null);
  },
};

export const sets = {
  async insert(section: string, payload: unknown, createdBy: string): Promise<number> {
    const info = db
      .prepare(
        "INSERT INTO generated_sets (section, payload, created_by) VALUES (?, ?, ?)",
      )
      .run(section, JSON.stringify(payload), createdBy);
    return Number(info.lastInsertRowid);
  },
  async takeFromPool(section: string): Promise<GeneratedSet | undefined> {
    const row = db
      .prepare(
        "SELECT * FROM generated_sets WHERE section = ? AND status = 'pooled' ORDER BY created_at LIMIT 1",
      )
      .get(section) as GeneratedSet | undefined;
    if (row) {
      db.prepare("UPDATE generated_sets SET status = 'served' WHERE id = ?").run(
        row.id,
      );
    }
    return row;
  },
  async byId(id: number): Promise<GeneratedSet | undefined> {
    return db.prepare("SELECT * FROM generated_sets WHERE id = ?").get(id) as
      | GeneratedSet
      | undefined;
  },
  async poolCount(section: string): Promise<number> {
    return (
      db
        .prepare(
          "SELECT COUNT(*) c FROM generated_sets WHERE section = ? AND status = 'pooled'",
        )
        .get(section) as { c: number }
    ).c;
  },
  async markServed(id: number): Promise<void> {
    db.prepare("UPDATE generated_sets SET status = 'served' WHERE id = ?").run(id);
  },
  async updatePayload(id: number, payload: unknown): Promise<void> {
    db.prepare("UPDATE generated_sets SET payload = ? WHERE id = ?").run(
      JSON.stringify(payload),
      id,
    );
  },
  /** Inserts as 'pending' - judge-accepted, but not yet servable to real
   * users until an admin approves it on the Question sets review page. Was
   * previously inserted straight to 'pooled' (live immediately), which is
   * exactly the "post before I've looked at it" problem this status fixes. */
  async insertWithQuality(
    section: string,
    payload: unknown,
    createdBy: string,
    qualityScore: number,
    judgeNotes: string,
  ): Promise<number> {
    const info = db
      .prepare(
        "INSERT INTO generated_sets (section, payload, created_by, quality_score, judge_notes, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      )
      .run(section, JSON.stringify(payload), createdBy, qualityScore, judgeNotes);
    return Number(info.lastInsertRowid);
  },
  /** Admin approval: moves a reviewed 'pending' set into the live pool. */
  async approve(id: number): Promise<void> {
    db.prepare("UPDATE generated_sets SET status = 'pooled' WHERE id = ? AND status = 'pending'").run(id);
  },
  /** Highest-quality pooled set in `section` the user has NOT seen yet, or
   * undefined if they've seen them all. The caller should generate a fresh set
   * when this returns undefined rather than re-serving an old one. */
  async pickForUser(section: string, userId: number): Promise<GeneratedSet | undefined> {
    // Only serve JUDGE-GRADED sets (quality_score NOT NULL). Legacy pre-grading
    // rows carry the old wrong/off-by-one keys, so they're never picked;
    // exhausting graded sets makes the route generate fresh instead.
    return db
      .prepare(
        `SELECT g.* FROM generated_sets g
           WHERE g.section = ?
             AND g.status = 'pooled'
             AND g.quality_score IS NOT NULL
             AND g.id NOT IN (SELECT set_id FROM user_seen_sets WHERE user_id = ?)
           ORDER BY g.quality_score DESC, g.created_at DESC LIMIT 1`,
      )
      .get(section, userId) as GeneratedSet | undefined;
  },
  /** Last-resort fallback: the set this user saw longest ago. Only used when
   * the pool is exhausted AND fresh generation failed, so we never hand the
   * user an error when at least some content exists. */
  async pickSeenLRU(section: string, userId: number): Promise<GeneratedSet | undefined> {
    return db
      .prepare(
        `SELECT g.* FROM generated_sets g
           JOIN user_seen_sets s ON s.set_id = g.id
           WHERE g.section = ? AND s.user_id = ?
           ORDER BY s.seen_at ASC LIMIT 1`,
      )
      .get(section, userId) as GeneratedSet | undefined;
  },
  async qualityPoolCount(section: string): Promise<number> {
    return (
      db
        .prepare(
          "SELECT COUNT(*) c FROM generated_sets WHERE section = ? AND quality_score IS NOT NULL",
        )
        .get(section) as { c: number }
    ).c;
  },
  /** Admin browse: newest-first page of sets, optionally filtered by section.
   * Fetch `limit`+1 rows so the caller can detect a next page cheaply. */
  async listPaged(
    section: string | null,
    limit: number,
    offset: number,
    status?: string | null,
  ): Promise<PagedSet[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (section) {
      clauses.push("section = ?");
      params.push(section);
    }
    if (status) {
      clauses.push("status = ?");
      params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db
      .prepare(
        `SELECT id, section, payload, status, quality_score, judge_notes, created_at
           FROM generated_sets ${where}
           ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as PagedSet[];
  },
  /** Hard-delete a set. Cascades to attempts and user_seen_sets. */
  async delete(id: number): Promise<void> {
    db.prepare("DELETE FROM generated_sets WHERE id = ?").run(id);
  },

  // ---- incremental draft building (mirror of db-pg.ts) -------------------
  async getDraft(
    section: string,
    maxAgeMinutes = 180,
  ): Promise<{ id: number; payload: string } | undefined> {
    return db
      .prepare(
        `SELECT id, payload FROM generated_sets
           WHERE section = ? AND status = 'draft'
             AND created_at > datetime('now', ?)
           ORDER BY created_at DESC LIMIT 1`,
      )
      .get(section, `-${maxAgeMinutes} minutes`) as
      | { id: number; payload: string }
      | undefined;
  },
  async createDraft(section: string, payload: unknown): Promise<number> {
    const info = db
      .prepare(
        "INSERT INTO generated_sets (section, payload, status, created_by) VALUES (?, ?, 'draft', 'builder')",
      )
      .run(section, JSON.stringify(payload));
    return Number(info.lastInsertRowid);
  },
  async updateDraft(id: number, payload: unknown): Promise<void> {
    db.prepare(
      "UPDATE generated_sets SET payload = ? WHERE id = ? AND status = 'draft'",
    ).run(JSON.stringify(payload), id);
  },
  async finalizeDraft(
    id: number,
    payload: unknown,
    qualityScore: number,
    judgeNotes: string,
  ): Promise<void> {
    db.prepare(
      `UPDATE generated_sets
         SET payload = ?, status = 'pooled', quality_score = ?, judge_notes = ?
         WHERE id = ? AND status = 'draft'`,
    ).run(JSON.stringify(payload), qualityScore, judgeNotes, id);
  },
  async deleteDraft(id: number): Promise<void> {
    db.prepare("DELETE FROM generated_sets WHERE id = ? AND status = 'draft'").run(id);
  },
  async purgeStaleDrafts(maxAgeMinutes = 180): Promise<void> {
    db.prepare(
      `DELETE FROM generated_sets WHERE status = 'draft' AND created_at < datetime('now', ?)`,
    ).run(`-${maxAgeMinutes} minutes`);
  },
};

export const userSeen = {
  async mark(userId: number, setId: number): Promise<void> {
    db.prepare(
      "INSERT OR IGNORE INTO user_seen_sets (user_id, set_id) VALUES (?, ?)",
    ).run(userId, setId);
  },
};

export const attempts = {
  async create(
    userId: number,
    setId: number,
    section: string,
    extra?: { mockId?: number; phase?: string },
  ): Promise<number> {
    const info = db
      .prepare(
        "INSERT INTO attempts (user_id, set_id, section, mock_id, phase) VALUES (?, ?, ?, ?, ?)",
      )
      .run(userId, setId, section, extra?.mockId ?? null, extra?.phase ?? null);
    return Number(info.lastInsertRowid);
  },
  async byId(id: number): Promise<Attempt | undefined> {
    return db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as
      | Attempt
      | undefined;
  },
  async byMock(mockId: number): Promise<Attempt[]> {
    return db.prepare("SELECT * FROM attempts WHERE mock_id = ? ORDER BY id").all(mockId) as Attempt[];
  },
  async listForUser(userId: number, section?: string): Promise<Attempt[]> {
    if (section) {
      return db
        .prepare(
          "SELECT * FROM attempts WHERE user_id = ? AND section = ? ORDER BY created_at DESC",
        )
        .all(userId, section) as Attempt[];
    }
    return db
      .prepare("SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as Attempt[];
  },
  async submit(id: number, answers: unknown, score: number, total: number, rawScore: number): Promise<void> {
    db.prepare(
      `UPDATE attempts SET answers = ?, score = ?, total = ?, raw_score = ?, submitted = 1,
       submitted_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify(answers), score, total, rawScore, id);
  },
  /** This user's best raw_score per section, for their public profile card. */
  async bestScoresByUser(userId: number): Promise<{ section: string; best_score: number }[]> {
    return db
      .prepare(
        `SELECT section, MAX(raw_score) AS best_score FROM attempts
          WHERE user_id = ? AND submitted = 1 AND raw_score IS NOT NULL
          GROUP BY section`,
      )
      .all(userId) as { section: string; best_score: number }[];
  },
  /** Percentile of `rawScore` among every submitted attempt in `section`
   * (all users) - the share of attempts strictly below it. Real population
   * data; returns null (not 0) until there's more than just this one
   * attempt to compare against, so a lone user never sees a misleading
   * 100th percentile. */
  async percentile(section: string, rawScore: number): Promise<{ percentile: number; population: number } | null> {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN raw_score < ? THEN 1 ELSE 0 END) AS below
           FROM attempts WHERE section = ? AND submitted = 1 AND raw_score IS NOT NULL`,
      )
      .get(rawScore, section) as { total: number; below: number };
    if (row.total < 2) return null;
    return { percentile: (row.below / row.total) * 100, population: row.total };
  },
  /** Periodic autosave of in-progress answers, before submission. A no-op
   * once the attempt is submitted so a stray late autosave can't clobber
   * the final scored answers. */
  async saveDraft(id: number, answers: unknown): Promise<void> {
    db.prepare(
      "UPDATE attempts SET answers = ? WHERE id = ? AND submitted = 0",
    ).run(JSON.stringify(answers), id);
  },
  /** Per-section totals over this user's SUBMITTED attempts. */
  async statsByUser(userId: number): Promise<SectionStat[]> {
    return db
      .prepare(
        `SELECT section,
                COUNT(*) AS attempts,
                COALESCE(SUM(total), 0) AS solved,
                COALESCE(SUM(score), 0) AS correct
           FROM attempts
           WHERE user_id = ? AND submitted = 1
           GROUP BY section`,
      )
      .all(userId) as SectionStat[];
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
    const info = db.prepare("INSERT INTO mocks (user_id) VALUES (?)").run(userId);
    return Number(info.lastInsertRowid);
  },
  async byId(id: number): Promise<Mock | undefined> {
    return db.prepare("SELECT * FROM mocks WHERE id = ?").get(id) as Mock | undefined;
  },
  async listForUser(userId: number): Promise<Mock[]> {
    return db.prepare("SELECT * FROM mocks WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Mock[];
  },
  async submit(id: number): Promise<void> {
    db.prepare("UPDATE mocks SET submitted = 1, submitted_at = datetime('now') WHERE id = ?").run(id);
  },
  /** Cleans up a mock that failed to fully build (cascades to its attempts). */
  async remove(id: number): Promise<void> {
    db.prepare("DELETE FROM mocks WHERE id = ?").run(id);
  },
  /** Percentile of a full-mock total (summed raw_score across its five
   * section attempts) against every OTHER submitted mock, across all
   * users. Same null-below-population-2 rule as the sectional percentile -
   * an honest "not enough data" instead of a fake 100th percentile. */
  async percentile(totalRawScore: number): Promise<{ percentile: number; population: number } | null> {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN totalScore < ? THEN 1 ELSE 0 END) AS below
           FROM (
             SELECT m.id, SUM(a.raw_score) AS totalScore
               FROM mocks m JOIN attempts a ON a.mock_id = m.id
              WHERE m.submitted = 1
              GROUP BY m.id
           )`,
      )
      .get(totalRawScore) as { total: number; below: number };
    if (row.total < 2) return null;
    return { percentile: (row.below / row.total) * 100, population: row.total };
  },
};

// ---- user_external_stats (self-reported, other sources) ------------------
export const externalStats = {
  async list(userId: number): Promise<ExternalStat[]> {
    return db
      .prepare(
        "SELECT section, solved, accuracy FROM user_external_stats WHERE user_id = ?",
      )
      .all(userId) as ExternalStat[];
  },
  async upsert(
    userId: number,
    section: string,
    solved: number,
    accuracy: number | null,
  ): Promise<void> {
    db.prepare(
      `INSERT INTO user_external_stats (user_id, section, solved, accuracy, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, section)
         DO UPDATE SET solved = excluded.solved, accuracy = excluded.accuracy,
                       updated_at = datetime('now')`,
    ).run(userId, section, solved, accuracy);
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
    const info = db
      .prepare(
        `INSERT INTO question_reports (user_id, attempt_id, set_id, question_id, section, prompt_snapshot, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.userId, row.attemptId, row.setId, row.questionId, row.section, row.promptSnapshot, row.reason);
    return Number(info.lastInsertRowid);
  },
  async listOpen(): Promise<QuestionReport[]> {
    return db
      .prepare("SELECT * FROM question_reports WHERE status = 'open' ORDER BY created_at DESC")
      .all() as QuestionReport[];
  },
  async resolve(id: number): Promise<void> {
    db.prepare("UPDATE question_reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(id);
  },
};

/** Raw SQL escape hatch. Returns rows. */
export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  return db.prepare(text).all(...(params as unknown[])) as T[];
}
