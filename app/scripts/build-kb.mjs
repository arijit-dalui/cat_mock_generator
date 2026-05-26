/**
 * Knowledge-base builder.
 * Reads the templatized extraction documents (produced by the ingestion step)
 * and turns every parsed question into a categorized exemplar row in kb_items,
 * plus extracts reading-comprehension passages.
 *
 * Run with:  npm run build-kb
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { loadEnv } from "./_env.mjs";

loadEnv();

const appRoot = process.cwd();
const dbPath = path.resolve(appRoot, process.env.DATABASE_PATH || "./data/cat.db");
const docsDir = path.resolve(appRoot, process.env.EXTRACTION_DOCS || "../extraction/docs");

if (!fs.existsSync(docsDir)) {
  console.error("Extraction docs folder not found:", docsDir);
  console.error("Set EXTRACTION_DOCS in .env to the templatized docs folder.");
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

function sectionFromPath(p) {
  const s = p.toLowerCase();
  if (/varc|verbal/.test(s)) return "VARC";
  if (/lrdi|dilr|\blr\b|\bdi\b|logical|data interp/.test(s)) return "DILR";
  if (/quant|\bqa\b|geometry|algebra|arithmetic|number system/.test(s)) return "QA";
  if (/\brc\b|reading comp|passage/.test(s)) return "RC";
  return null;
}

const RC_HINTS = /passage|the author|according to the (passage|author)|the writer|paragraph above/i;
const JUMBLE_HINTS = /jumbl|arrange the (following )?sentences|logical (sequence|order)|rearrange/i;
const COMPLETE_HINTS = /complete the (paragraph|passage)|best completes|fills? (in )?the blank|fits in the blank/i;
const ODD_HINTS = /odd (one )?out|does not (fit|belong)|out of context|sentence that is (the )?odd/i;
const SUMMARY_HINTS = /summariz|best captures the (essence|gist)|the summary of/i;
const DI_HINTS = /\btable\b|\bgraph\b|\bchart\b|pie chart|bar (graph|chart)|following data|the data (given|above)/i;
const LR_HINTS = /arrangement|seated|sitting|ranking|the following conditions|each of the following|exactly one|puzzle/i;

const QA_TOPICS = [
  ["geometry", /triangle|circle|angle|polygon|rectangle|square|radius|perimeter|hexagon|coordinate|parallel/i],
  ["algebra", /equation|polynomial|quadratic|inequalit|function f\(|roots? of/i],
  ["modern_math", /probabilit|permutation|combination|factorial|arrangement of letters/i],
  ["number_system", /remainder|divisib|prime|factors of|digits of|HCF|LCM|integer/i],
  ["arithmetic", /percent|profit|loss|ratio|average|speed|distance|time taken|interest|mixture|discount|fraction/i],
];

function classify(text, pathHint) {
  const t = text.slice(0, 1200);
  const ps = sectionFromPath(pathHint);
  if (RC_HINTS.test(t) && !/find the value|how many|calculate/i.test(t)) {
    return { section: "RC", subtype: "rc" };
  }
  if (JUMBLE_HINTS.test(t)) return { section: "VA", subtype: "para_jumble" };
  if (ODD_HINTS.test(t)) return { section: "VA", subtype: "odd_one_out" };
  if (COMPLETE_HINTS.test(t)) return { section: "VA", subtype: "para_completion" };
  if (SUMMARY_HINTS.test(t)) return { section: "VA", subtype: "summary" };
  if (DI_HINTS.test(t)) return { section: "DI", subtype: "di" };
  if (LR_HINTS.test(t) && ps !== "QA") return { section: "LR", subtype: "lr" };
  const looksMath = /\d/.test(t) && /(find|how many|value of|calculate|equals|sum of|number of)/i.test(t);
  if (ps === "QA" || looksMath) {
    for (const [name, rx] of QA_TOPICS) if (rx.test(t)) return { section: "QA", subtype: name };
    return { section: "QA", subtype: "qa_misc" };
  }
  if (ps === "VARC") return { section: "VA", subtype: "va_other" };
  if (ps === "DILR") return { section: "LR", subtype: "lr" };
  if (ps === "RC") return { section: "RC", subtype: "rc" };
  if (ps) return { section: ps, subtype: ps.toLowerCase() };
  return { section: "VA", subtype: "va_other" };
}

function parseBlock(raw) {
  let answer = null;
  const am = raw.match(/correct\s+answer\s*[:\-]?\s*([A-Da-d1-5])/i);
  if (am) answer = am[1].toLowerCase();
  let solution = null;
  const sm = raw.match(/\n\s*sol(?:ution)?\s*[:\.]\s*/i);
  if (sm) solution = raw.slice(sm.index + sm[0].length).trim();
  const opts = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[\(\[]?[A-Da-d1-5][\)\].]?\s*$/.test(lines[i])) {
      const next = (lines[i + 1] || "").trim();
      if (next && next.length > 1) opts.push(next);
    }
  }
  return { answer, solution, options: opts };
}

const META_SOURCE = /\|\s*Source file\s*\|\s*`([^`]+)`/i;

function extractPassages(fullRegion) {
  const passages = [];
  const parts = fullRegion.split(/\n#### /);
  for (const part of parts) {
    if (!/^Directions? for questions?/i.test(part)) continue;
    let body = part.split(/\n\*\*Q/)[0];
    body = body.replace(/^Directions?[^\n]*\n/i, "").trim();
    const words = body.split(/\s+/).filter(Boolean).length;
    if (words < 120 || words > 1400) continue;
    if (DI_HINTS.test(body.slice(0, 400))) continue;
    passages.push({ text: body, words });
  }
  return passages;
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const files = walk(docsDir);
console.log("Scanning " + files.length + " templatized documents from", docsDir);

db.exec("DELETE FROM kb_items");

const insert = db.prepare(
  "INSERT INTO kb_items (section, subtype, source_file, stem, options, answer, solution, word_count) " +
  "VALUES (@section, @subtype, @source_file, @stem, @options, @answer, @solution, @word_count)"
);

const seen = new Set();
const stats = {};
let docsWithQs = 0, inserted = 0, dupes = 0, passagesAdded = 0;

const run = db.transaction((files) => {
  for (const file of files) {
    const md = fs.readFileSync(file, "utf-8");
    const source = (md.match(META_SOURCE) || [])[1] || path.relative(docsDir, file);
    const startIdx = md.indexOf("## Parsed questions");
    const endIdx = md.indexOf("## Full extracted content");

    if (startIdx !== -1) {
      const region = md.slice(startIdx, endIdx === -1 ? undefined : endIdx);
      const blocks = region.split(/\n### Question /).slice(1);
      if (blocks.length) docsWithQs++;
      for (const block of blocks) {
        const fenceA = block.indexOf("```");
        if (fenceA === -1) continue;
        const fenceB = block.indexOf("```", fenceA + 3);
        if (fenceB === -1) continue;
        const raw = block.slice(fenceA + 3, fenceB).trim();
        if (raw.length < 25) continue;
        const hash = crypto.createHash("md5").update(raw).digest("hex");
        if (seen.has(hash)) { dupes++; continue; }
        seen.add(hash);
        const { section, subtype } = classify(raw, source);
        const { answer, solution, options } = parseBlock(raw);
        insert.run({
          section, subtype, source_file: source, stem: raw,
          options: options.length ? JSON.stringify(options) : null,
          answer, solution, word_count: raw.split(/\s+/).length,
        });
        inserted++;
        const key = section + "/" + subtype;
        stats[key] = (stats[key] || 0) + 1;
      }
    }

    if (endIdx !== -1) {
      for (const p of extractPassages(md.slice(endIdx))) {
        const hash = crypto.createHash("md5").update(p.text).digest("hex");
        if (seen.has(hash)) { dupes++; continue; }
        seen.add(hash);
        insert.run({
          section: "RC", subtype: "rc_passage", source_file: source,
          stem: p.text, options: null, answer: null, solution: null,
          word_count: p.words,
        });
        passagesAdded++;
        stats["RC/rc_passage"] = (stats["RC/rc_passage"] || 0) + 1;
      }
    }
  }
});

run(files);

console.log("\nDocuments with parsed questions: " + docsWithQs);
console.log("Question exemplars: " + inserted + "   RC passages: " + passagesAdded);
console.log("(skipped " + dupes + " exact duplicates)\n");
console.log("By section / subtype:");
for (const key of Object.keys(stats).sort())
  console.log("  " + key.padEnd(22) + " " + stats[key]);

const bySection = db
  .prepare("SELECT section, COUNT(*) c FROM kb_items GROUP BY section ORDER BY section")
  .all();
console.log("\nKnowledge base totals:");
for (const r of bySection) console.log("  " + r.section.padEnd(6) + " " + r.c);

db.close();
console.log("\nKnowledge base built.");
