/**
 * Initialises the SQLite database and seeds the admin account.
 * Run with:  npm run init-db
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { loadEnv } from "./_env.mjs";

loadEnv();

const appRoot = process.cwd();
const dbPath = path.resolve(appRoot, process.env.DATABASE_PATH || "./data/cat.db");
const adminUser = process.env.ADMIN_USERNAME || "admin";
const adminPass = process.env.ADMIN_PASSWORD || "";

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

// ---- seed admin -----------------------------------------------------------
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
