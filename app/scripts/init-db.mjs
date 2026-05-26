/**
 * Initialises the database (SQLite locally, Postgres if DATABASE_URL is set)
 * and seeds the admin account.
 * Run with:  npm run init-db
 */
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { loadEnv } from "./_env.mjs";

loadEnv();

const appRoot = process.cwd();
const adminUser = process.env.ADMIN_USERNAME || "admin";
const adminPass = process.env.ADMIN_PASSWORD || "";

if (process.env.DATABASE_URL) {
  await initPostgres();
} else {
  await initSqlite();
}

async function initSqlite() {
  const { default: Database } = await import("better-sqlite3");
  const dbPath = path.resolve(
    appRoot,
    process.env.DATABASE_PATH || "./data/cat.db",
  );
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(
    path.join(appRoot, "src/lib/schema.sql"),
    "utf-8",
  );
  db.exec(schema);
  console.log("Schema applied ->", dbPath);

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(adminUser);

  if (existing) {
    console.log(`Admin account "${adminUser}" already exists - left unchanged.`);
  } else {
    if (!adminPass) {
      console.error(
        "ADMIN_PASSWORD is not set in .env - cannot seed the admin account.",
      );
      process.exit(1);
    }
    const hash = bcrypt.hashSync(adminPass, 12);
    db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
    ).run(adminUser, hash);
    console.log(`Admin account "${adminUser}" created.`);
  }
  db.close();
  console.log("Database ready.");
}

async function initPostgres() {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  const schema = fs.readFileSync(
    path.join(appRoot, "src/lib/schema-pg.sql"),
    "utf-8",
  );
  await sql.unsafe(schema);
  console.log("Postgres schema applied.");

  const rows = await sql`SELECT id FROM users WHERE username = ${adminUser}`;
  if (rows.length) {
    console.log(`Admin account "${adminUser}" already exists - left unchanged.`);
  } else {
    if (!adminPass) {
      console.error(
        "ADMIN_PASSWORD is not set - cannot seed the admin account.",
      );
      await sql.end();
      process.exit(1);
    }
    const hash = bcrypt.hashSync(adminPass, 12);
    await sql`INSERT INTO users (username, password_hash, role) VALUES (${adminUser}, ${hash}, 'admin')`;
    console.log(`Admin account "${adminUser}" created.`);
  }
  await sql.end();
  console.log("Database ready.");
}
