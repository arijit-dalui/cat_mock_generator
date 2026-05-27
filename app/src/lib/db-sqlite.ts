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
  submitted: number;
  created_at: string;
  submitted_at: string | null;
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
  async insertWithQuality(
    section: string,
    payload: unknown,
    createdBy: string,
    qualityScore: number,
    judgeNotes: string,
  ): Promise<number> {
    const info = db
      .prepare(
        "INSERT INTO generated_sets (section, payload, created_by, quality_score, judge_notes) VALUES (?, ?, ?, ?, ?)",
      )
      .run(section, JSON.stringify(payload), createdBy, qualityScore, judgeNotes);
    return Number(info.lastInsertRowid);
  },
  async pickForUser(section: string, userId: number): Promise<GeneratedSet | undefined> {
    const fresh = db
      .prepare(
        `SELECT g.* FROM generated_sets g
           WHERE g.section = ?
             AND g.id NOT IN (SELECT set_id FROM user_seen_sets WHERE user_id = ?)
           ORDER BY g.quality_score DESC, g.created_at DESC LIMIT 1`,
      )
      .get(section, userId) as GeneratedSet | undefined;
    if (fresh) return fresh;
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
  async cleanupOld(maxAgeHours: number, maxRows: number): Promise<number> {
    if (maxAgeHours <= 0) return 0;
    const info = db
      .prepare(
        `DELETE FROM generated_sets
           WHERE id IN (
             SELECT g.id FROM generated_sets g
               LEFT JOIN attempts a ON a.set_id = g.id
               WHERE g.created_at < datetime('now', ?)
                 AND a.id IS NULL
               ORDER BY g.created_at ASC LIMIT ?
           )`,
      )
      .run(`-${maxAgeHours} hours`, maxRows);
    return Number(info.changes ?? 0);
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
  async create(userId: number, setId: number, section: string): Promise<number> {
    const info = db
      .prepare(
        "INSERT INTO attempts (user_id, set_id, section) VALUES (?, ?, ?)",
      )
      .run(userId, setId, section);
    return Number(info.lastInsertRowid);
  },
  async byId(id: number): Promise<Attempt | undefined> {
    return db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as
      | Attempt
      | undefined;
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
  async submit(id: number, answers: unknown, score: number, total: number): Promise<void> {
    db.prepare(
      `UPDATE attempts SET answers = ?, score = ?, total = ?, submitted = 1,
       submitted_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify(answers), score, total, id);
  },
};

/** Raw SQL escape hatch. Returns rows. */
export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  return db.prepare(text).all(...(params as unknown[])) as T[];
}
