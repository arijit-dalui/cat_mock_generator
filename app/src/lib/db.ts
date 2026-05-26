/**
 * SQLite data-access layer. One shared connection, schema applied on first use.
 * Keeping every query in this module means the storage engine can later be
 * swapped (e.g. to Postgres) without touching the rest of the app.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config";

// ---- connection (cached across Next.js hot reloads) ----------------------
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

export const db: Database.Database = global.__catDb ?? open();
if (process.env.NODE_ENV !== "production") global.__catDb = db;

// ---- types ----------------------------------------------------------------
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

// ---- users ----------------------------------------------------------------
export const users = {
  byUsername(username: string): User | undefined {
    return db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username) as User | undefined;
  },
  byId(id: number): User | undefined {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | User
      | undefined;
  },
  create(username: string, passwordHash: string, role: "user" | "admin" = "user"): User {
    const info = db
      .prepare(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
      )
      .run(username, passwordHash, role);
    return users.byId(Number(info.lastInsertRowid))!;
  },
  count(): number {
    return (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
  },
};

// ---- sessions -------------------------------------------------------------
export const sessions = {
  create(token: string, userId: number, expiresAt: string) {
    db.prepare(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    ).run(token, userId, expiresAt);
  },
  get(token: string): SessionRow | undefined {
    return db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) as
      | SessionRow
      | undefined;
  },
  destroy(token: string) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  },
  purgeExpired() {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  },
};

// ---- events (analytics) ---------------------------------------------------
export const events = {
  log(
    type: string,
    userId: number | null,
    section?: string | null,
    meta?: unknown,
  ) {
    db.prepare(
      "INSERT INTO events (user_id, type, section, meta) VALUES (?, ?, ?, ?)",
    ).run(userId, type, section ?? null, meta ? JSON.stringify(meta) : null);
  },
};

// ---- generated sets -------------------------------------------------------
export const sets = {
  insert(section: string, payload: unknown, createdBy: string): number {
    const info = db
      .prepare(
        "INSERT INTO generated_sets (section, payload, created_by) VALUES (?, ?, ?)",
      )
      .run(section, JSON.stringify(payload), createdBy);
    return Number(info.lastInsertRowid);
  },
  /** Take one pooled set for a section and mark it served. */
  takeFromPool(section: string): GeneratedSet | undefined {
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
  byId(id: number): GeneratedSet | undefined {
    return db.prepare("SELECT * FROM generated_sets WHERE id = ?").get(id) as
      | GeneratedSet
      | undefined;
  },
  poolCount(section: string): number {
    return (
      db
        .prepare(
          "SELECT COUNT(*) c FROM generated_sets WHERE section = ? AND status = 'pooled'",
        )
        .get(section) as { c: number }
    ).c;
  },
};

// ---- attempts -------------------------------------------------------------
export const attempts = {
  create(userId: number, setId: number, section: string): number {
    const info = db
      .prepare(
        "INSERT INTO attempts (user_id, set_id, section) VALUES (?, ?, ?)",
      )
      .run(userId, setId, section);
    return Number(info.lastInsertRowid);
  },
  byId(id: number): Attempt | undefined {
    return db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as
      | Attempt
      | undefined;
  },
  listForUser(userId: number, section?: string): Attempt[] {
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
  submit(id: number, answers: unknown, score: number, total: number) {
    db.prepare(
      `UPDATE attempts SET answers = ?, score = ?, total = ?, submitted = 1,
       submitted_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify(answers), score, total, id);
  },
};
