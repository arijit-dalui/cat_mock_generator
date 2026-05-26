/**
 * Postgres data-access layer (used in cloud deployments via DATABASE_URL).
 * Mirrors the shape of db-sqlite.ts but every method is async.
 *
 * The schema is applied on first use; safe because every CREATE is IF NOT EXISTS.
 */
import postgres from "postgres";
import fs from "fs";
import path from "path";
import { config } from "./config";
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

async function ensureSchema(): Promise<void> {
  if (global.__catSchemaApplied) return;
  const schema = fs.readFileSync(
    path.join(config.appRoot, "src/lib/schema-pg.sql"),
    "utf-8",
  );
  await sql.unsafe(schema);
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
