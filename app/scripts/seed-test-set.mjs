/**
 * Dev-only helper: inserts one hand-written, known-good VA set and an
 * attempt on it for the given user, bypassing the LLM entirely. Useful for
 * exercising the solving UI (timer, palette, TITA, scoring) without waiting
 * on generation. Not part of the app's runtime path.
 *
 * Run with: node scripts/seed-test-set.mjs <username>
 */
import Database from "better-sqlite3";
import { loadEnv } from "./_env.mjs";

loadEnv();

const username = process.argv[2] || "tester";
const db = new Database(process.env.DATABASE_PATH || "./data/cat.db");

const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (!user) {
  console.error(`No user "${username}" - register that account first.`);
  process.exit(1);
}

const set = {
  section: "VA",
  kind: "questions",
  items: [
    {
      id: "q1",
      type: "para_completion",
      format: "mcq",
      prompt:
        "The committee's decision, though _____ by most members, was met with fierce resistance from the minority.",
      options: ["welcomed", "opposed", "ignored", "delayed"],
      answer: 0,
      explanations: [
        "Correct - contrasts with the fierce resistance that follows.",
        "Would not create the contrast the sentence sets up.",
        "Does not fit the 'met with resistance' contrast.",
        "Changes the meaning; the sentence is about reception, not timing.",
      ],
      solution: "The word must set up a contrast with 'fierce resistance' - only 'welcomed' does that.",
    },
    {
      id: "q2",
      type: "odd_one_out",
      format: "mcq",
      prompt:
        "1. The auditor flagged three irregularities in the ledger.\n2. Quarterly revenue rose eight percent year-on-year.\n3. The new intern struggled with the filing system.\n4. Net margins contracted due to rising input costs.\n5. Cash reserves remained flat compared to last quarter.",
      options: ["Sentence 1", "Sentence 2", "Sentence 3", "Sentence 4"],
      answer: 2,
      explanations: [
        "Belongs with the financial-reporting theme.",
        "Belongs with the financial-reporting theme.",
        "Correct - about an intern's onboarding, not financial reporting.",
        "Belongs with the financial-reporting theme.",
      ],
      solution: "All other sentences describe financial reporting metrics; sentence 3 is unrelated.",
    },
    {
      id: "q3",
      type: "tita",
      format: "tita",
      prompt:
        "If the sequence 2, 5, 10, 17, 26 continues with the same pattern, what is the 7th term?",
      options: [],
      answer: "50",
      explanations: [],
      solution: "Differences are 3, 5, 7, 9, 11, 13 (odd numbers) - term(n) = n^2 + 1. term(7) = 50.",
    },
  ],
};

const info = db
  .prepare(
    "INSERT INTO generated_sets (section, payload, status, created_by, quality_score) VALUES (?, ?, 'served', 'seed-script', 9)",
  )
  .run(set.section, JSON.stringify(set));
const setId = Number(info.lastInsertRowid);

const attemptInfo = db
  .prepare("INSERT INTO attempts (user_id, set_id, section) VALUES (?, ?, ?)")
  .run(user.id, setId, set.section);

console.log(`Seeded set #${setId} and attempt #${attemptInfo.lastInsertRowid} for "${username}".`);
console.log(`Open: /practice/${attemptInfo.lastInsertRowid}`);
db.close();
