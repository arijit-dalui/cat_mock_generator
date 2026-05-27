/**
 * Data-access router. Picks the SQLite (local) or Postgres (cloud) adapter
 * based on whether DATABASE_URL is set. Both adapters expose the same async
 * API: users, sessions, sets, attempts, events.
 *
 * If you are extending the schema or adding queries, update BOTH
 * db-sqlite.ts and db-pg.ts so local dev and production stay in sync.
 */

const usingPostgres = !!process.env.DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const impl: typeof import("./db-sqlite") = usingPostgres
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./db-pg")
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./db-sqlite");

export const users = impl.users;
export const sessions = impl.sessions;
export const events = impl.events;
export const sets = impl.sets;
export const attempts = impl.attempts;
export const userSeen = (impl as unknown as { userSeen: { mark: (u: number, s: number) => Promise<void> } }).userSeen;
export const query = impl.query;
// Only meaningful in SQLite mode. Postgres adapter exports null/undefined here.
export const db = (impl as unknown as { db?: unknown }).db ?? null;

export type { User, SessionRow, GeneratedSet, Attempt } from "./db-sqlite";
