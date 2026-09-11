/**
 * Dev-only: seeds ~100 demo accounts with hundreds of attempts spread
 * across all five sections, so pages that need real population data
 * (comparative percentile, trend charts, admin stats) have something
 * realistic to render against. Bypasses the LLM entirely - one hand-written
 * template set per section, reused across all synthetic attempts (only the
 * per-attempt ANSWERS vary, which is all scoring/percentile/topic-accuracy
 * actually cares about).
 *
 * Clearly a dev fixture, not real users: usernames are demo1..demo100,
 * password is "demo1234" for all of them. Safe to run against a local
 * SQLite db; never point this at a production DATABASE_URL.
 *
 * Run with: node scripts/seed-bulk-demo.mjs [userCount]
 */
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { loadEnv } from "./_env.mjs";

loadEnv();

if (process.env.DATABASE_URL) {
  console.error("Refusing to run against DATABASE_URL (looks like a cloud/production target).");
  process.exit(1);
}

const USER_COUNT = parseInt(process.argv[2] || "100", 10);
const db = new Database(process.env.DATABASE_PATH || "./data/cat.db");
db.pragma("journal_mode = WAL");

const SECTIONS = ["VA", "RC", "DI", "LR", "QA"];

// One structurally-valid template set per section. Content is filler -
// only `type`, `format`, `answer`, and option count matter for scoring,
// topic-accuracy, and the palette.
const TEMPLATES = {
  VA: {
    section: "VA",
    kind: "questions",
    items: [
      { id: "va1", type: "para_completion", format: "mcq", prompt: "Demo VA para-completion stem.", options: ["A", "B", "C", "D"], answer: 0, explanations: ["", "", "", ""], solution: "Demo solution." },
      { id: "va2", type: "para_jumble", format: "mcq", prompt: "Demo VA para-jumble stem.", options: ["A", "B", "C", "D"], answer: 1, explanations: ["", "", "", ""], solution: "Demo solution." },
      { id: "va3", type: "odd_one_out", format: "mcq", prompt: "Demo VA odd-one-out stem.", options: ["A", "B", "C", "D"], answer: 2, explanations: ["", "", "", ""], solution: "Demo solution." },
      { id: "va4", type: "summary", format: "tita", prompt: "Demo VA summary stem.", options: [], answer: "42", explanations: [], solution: "Demo solution." },
    ],
  },
  QA: {
    section: "QA",
    kind: "questions",
    items: [
      { id: "qa1", type: "geometry", format: "mcq", prompt: "Demo QA geometry stem.", options: ["A", "B", "C", "D"], answer: 0, explanations: ["", "", "", ""], solution: "Demo solution." },
      { id: "qa2", type: "algebra", format: "mcq", prompt: "Demo QA algebra stem.", options: ["A", "B", "C", "D"], answer: 1, explanations: ["", "", "", ""], solution: "Demo solution." },
      { id: "qa3", type: "arithmetic", format: "tita", prompt: "Demo QA arithmetic stem.", options: [], answer: "17", explanations: [], solution: "Demo solution." },
      { id: "qa4", type: "number_system", format: "mcq", prompt: "Demo QA number-system stem.", options: ["A", "B", "C", "D"], answer: 3, explanations: ["", "", "", ""], solution: "Demo solution." },
    ],
  },
  RC: {
    section: "RC",
    kind: "sets",
    sets: [
      {
        id: "rc-set1",
        contextLabel: "Passage 1",
        context: "Demo RC passage text.",
        source: "",
        questions: [
          { id: "rc1", type: "rc", format: "mcq", prompt: "Demo RC Q1.", options: ["A", "B", "C", "D"], answer: 0, explanations: ["", "", "", ""], solution: "Demo solution." },
          { id: "rc2", type: "rc", format: "mcq", prompt: "Demo RC Q2.", options: ["A", "B", "C", "D"], answer: 1, explanations: ["", "", "", ""], solution: "Demo solution." },
          { id: "rc3", type: "rc", format: "mcq", prompt: "Demo RC Q3.", options: ["A", "B", "C", "D"], answer: 2, explanations: ["", "", "", ""], solution: "Demo solution." },
          { id: "rc4", type: "rc", format: "mcq", prompt: "Demo RC Q4.", options: ["A", "B", "C", "D"], answer: 3, explanations: ["", "", "", ""], solution: "Demo solution." },
        ],
      },
    ],
  },
  DI: {
    section: "DI",
    kind: "sets",
    sets: [
      {
        id: "di-set1",
        contextLabel: "Data Set 1",
        context: "Demo DI data table.",
        source: "",
        questions: [
          { id: "di1", type: "di", format: "mcq", prompt: "Demo DI Q1.", options: ["A", "B", "C", "D"], answer: 0, explanations: ["", "", "", ""], solution: "Demo solution." },
          { id: "di2", type: "di", format: "mcq", prompt: "Demo DI Q2.", options: ["A", "B", "C", "D"], answer: 1, explanations: ["", "", "", ""], solution: "Demo solution." },
          { id: "di3", type: "di", format: "tita", prompt: "Demo DI Q3.", options: [], answer: "9", explanations: [], solution: "Demo solution." },
          { id: "di4", type: "di", format: "mcq", prompt: "Demo DI Q4.", options: ["A", "B", "C", "D"], answer: 3, explanations: ["", "", "", ""], solution: "Demo solution." },
        ],
      },
    ],
  },
  LR: {
    section: "LR",
    kind: "sets",
    sets: [
      {
        id: "lr-set1",
        contextLabel: "Puzzle 1",
        context: "Demo LR puzzle setup.",
        source: "",
        questions: [
          { id: "lr1", type: "lr", format: "mcq", prompt: "Demo LR Q1.", options: ["A", "B", "C", "D"], answer: 0, explanations: ["", "", "", ""], solution: "Demo solution." },
          { id: "lr2", type: "lr", format: "mcq", prompt: "Demo LR Q2.", options: ["A", "B", "C", "D"], answer: 1, explanations: ["", "", "", ""], solution: "Demo solution." },
          { id: "lr3", type: "lr", format: "mcq", prompt: "Demo LR Q3.", options: ["A", "B", "C", "D"], answer: 2, explanations: ["", "", "", ""], solution: "Demo solution." },
          { id: "lr4", type: "lr", format: "tita", prompt: "Demo LR Q4.", options: [], answer: "3", explanations: [], solution: "Demo solution." },
        ],
      },
    ],
  },
};

function allQuestions(set) {
  return set.kind === "questions" ? set.items : set.sets.flatMap((s) => s.questions);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

/** Simulate one attempt's answers at a given skill level (0..1 = odds of
 * answering a question correctly when attempted at all). */
function simulateAnswers(set, skill) {
  const answers = {};
  for (const q of allQuestions(set)) {
    const attempted = Math.random() < 0.9; // ~10% skipped, like a real candidate under time pressure
    if (!attempted) continue;
    const correct = Math.random() < skill;
    if (q.format === "tita") {
      answers[q.id] = correct ? String(q.answer) : String(Number(q.answer) + 1);
    } else {
      const wrongIdx = (Number(q.answer) + 1 + randInt(0, 2)) % q.options.length;
      answers[q.id] = correct ? q.answer : wrongIdx;
    }
  }
  return answers;
}

function scoreOf(set, answers) {
  let correct = 0;
  let total = 0;
  let rawScore = 0;
  for (const q of allQuestions(set)) {
    total += 1;
    const picked = answers[q.id];
    if (picked === undefined) continue;
    const isTita = q.format === "tita";
    const isCorrect = isTita ? String(picked) === String(q.answer) : Number(picked) === Number(q.answer);
    if (isCorrect) {
      correct += 1;
      rawScore += 3;
    } else if (!isTita) {
      rawScore -= 1;
    }
  }
  return { correct, total, rawScore };
}

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

const passwordHash = bcrypt.hashSync("demo1234", 10);

const insertUser = db.prepare(
  "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, 'user')",
);
const getUser = db.prepare("SELECT id FROM users WHERE username = ?");
const insertSet = db.prepare(
  "INSERT INTO generated_sets (section, payload, status, created_by, quality_score) VALUES (?, ?, 'served', 'seed-bulk-demo', 9)",
);
const insertAttempt = db.prepare(
  `INSERT INTO attempts (user_id, set_id, section, answers, score, total, raw_score, submitted, created_at, submitted_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
);

const run = db.transaction(() => {
  const setIdBySection = {};
  for (const section of SECTIONS) {
    const info = insertSet.run(section, JSON.stringify(TEMPLATES[section]));
    setIdBySection[section] = Number(info.lastInsertRowid);
  }

  let totalAttempts = 0;
  for (let i = 1; i <= USER_COUNT; i++) {
    const username = `demo${i}`;
    insertUser.run(username, passwordHash);
    const user = getUser.get(username);
    if (!user) continue; // already existed with a different id path - skip rather than guess

    for (const section of SECTIONS) {
      const skill = rand(0.3, 0.95); // this "user"'s accuracy ceiling for this section
      const attemptCount = randInt(1, 6);
      const set = TEMPLATES[section];
      for (let a = 0; a < attemptCount; a++) {
        const answers = simulateAnswers(set, skill + rand(-0.1, 0.1));
        const { correct, total, rawScore } = scoreOf(set, answers);
        const when = daysAgo(randInt(0, 60));
        insertAttempt.run(user.id, setIdBySection[section], section, JSON.stringify(answers), correct, total, rawScore, when, when);
        totalAttempts += 1;
      }
    }
  }
  return totalAttempts;
});

const totalAttempts = run();
console.log(`Seeded ${USER_COUNT} demo users (demo1..demo${USER_COUNT}, password "demo1234") and ${totalAttempts} submitted attempts across ${SECTIONS.join(", ")}.`);
db.close();
