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

const db: Database.Database = global.__catDb ?? open();
if (process.env.NODE_ENV !== "production") global.__catDb = db;

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
