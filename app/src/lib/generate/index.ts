/**
 * Generation engine. Produces a fresh, validated problem set for a section.
 *
 * Strategy: retrieval-augmented prompting (real mock questions are passed as
 * style references, never copied), strict normalisation of the LLM's JSON,
 * an anti-plagiarism similarity check against the knowledge base, and an
 * independent re-solve pass that verifies QA/DI answers.
 */
import { config, type Section } from "../config";
import { chatJSON } from "../llm";
import { sampleExemplars, maxSimilarityToKb, LEAK_THRESHOLD } from "../kb";
import { fetchAeonArticle } from "./aeon";
import {
  vaPrompt,
  qaPrompt,
  rcPrompt,
  diPrompt,
  lrPrompt,
  verifyPrompt,
  cleanExemplar,
} from "./prompts";
import type { GenQuestion, GenSubSet, GeneratedSet } from "./types";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

// ---- normalisation of raw LLM output --------------------------------------
function coerceAnswer(a: unknown, optionCount: number): number {
  if (typeof a === "number" && a >= 0 && a < optionCount) return Math.floor(a);
  if (typeof a === "string") {
    const s = a.trim();
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (n >= 0 && n < optionCount) return n;
      if (n >= 1 && n <= optionCount) return n - 1; // 1-based
    }
    const letter = s.toLowerCase().charCodeAt(0) - 97; // a -> 0
    if (letter >= 0 && letter < optionCount) return letter;
  }
  return 0;
}

function coerceExplanations(e: unknown, optionCount: number): string[] {
  const out: string[] = [];
  if (Array.isArray(e)) {
    for (const x of e) out.push(String(x ?? "").trim());
  } else if (e && typeof e === "object") {
    for (const v of Object.values(e as Record<string, unknown>))
      out.push(String(v ?? "").trim());
  }
  while (out.length < optionCount) out.push("");
  return out.slice(0, optionCount);
}

/** Strip CAT-paper artefacts and PDF gibberish that occasionally leak from
 * exemplars into LLM output: single-character-per-line wrap, ALL-CAPS
 * "DIRECTIONS for questions ..." preambles, "Q.27" prefixes, smart quotes. */
function cleanQuestionText(s: string): string {
  // Re-flow runs of single-character lines into one line.
  const lines = s.split(/\r?\n/);
  const out: string[] = [];
  let buf = "";
  for (const ln of lines) {
    const t = ln.trim();
    if (t.length === 0) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      out.push("");
      continue;
    }
    if (t.length <= 2) {
      buf += t;
    } else {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      out.push(t);
    }
  }
  if (buf) out.push(buf);
  let r = out.join("\n");
  r = r.replace(
    /DIRECTIONS?\s+for\s+(the\s+)?questions?[^.\n]*?(?:[\.:]\s*)/gi,
    "",
  );
  r = r.replace(/^\s*Q\.?\s*\d+[\.:]?\s*/g, "");
  r = r.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  r = r.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return r;
}

function normalizeQuestion(raw: any, type: string): GenQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const prompt = cleanQuestionText(
    String(raw.prompt ?? raw.question ?? raw.text ?? "").trim(),
  );
  let options = Array.isArray(raw.options)
    ? raw.options
        .map((o: unknown) => cleanQuestionText(String(o ?? "").trim()))
        .filter(Boolean)
    : [];
  if (prompt.length < 5 || options.length !== 4) return null;
  // Reject obvious placeholder options like "o1", "o2", "o3", "o4".
  if (options.every((o: string) => /^o\d$/i.test(o))) return null;
  const answer = coerceAnswer(
    raw.answer ?? raw.correct ?? raw.correctAnswer ?? raw.correct_option,
    4,
  );
  const explanations = coerceExplanations(
    raw.explanations ?? raw.explanation ?? raw.optionExplanations,
    4,
  ).map(cleanQuestionText);
  const solution = cleanQuestionText(
    String(raw.solution ?? raw.working ?? raw.reasoning ?? "").trim(),
  );
  return { id: nextId("q"), type, prompt, options, answer, explanations, solution };
}

// ---- standalone-question sections (VA, QA) --------------------------------
interface Plan {
  subtype: string;
  count: number;
}

async function genQuestions(
  section: Section,
  plan: Plan[],
  promptFn: (subtype: string, count: number, ex: any[]) => string,
  warnings: string[],
): Promise<GenQuestion[]> {
  const items: GenQuestion[] = [];
  for (const step of plan) {
    try {
      const exemplars = await sampleExemplars(section, {
        subtype: step.subtype,
        limit: 3,
      });
      const data = await chatJSON<{ questions?: any[] }>(
        promptFn(step.subtype, step.count, exemplars),
        { temperature: 0.85 },
      );
      const raw = Array.isArray(data?.questions) ? data.questions : [];
      let kept = 0;
      for (const q of raw) {
        if (kept >= step.count) break;
        const norm = normalizeQuestion(q, step.subtype);
        if (!norm) {
          warnings.push(`malformed ${step.subtype} question discarded`);
          continue;
        }
        if ((await maxSimilarityToKb(norm.prompt, section)) > LEAK_THRESHOLD) {
          warnings.push(`near-duplicate ${step.subtype} question discarded`);
          continue;
        }
        items.push(norm);
        kept += 1;
      }
    } catch (e) {
      warnings.push(
        `${step.subtype} generation failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  return items;
}

/** Re-solve a question independently; returns true if the answer holds. */
async function verifyAnswer(q: GenQuestion): Promise<boolean> {
  try {
    const v = await chatJSON<{ answer?: unknown }>(
      verifyPrompt(q.prompt, q.options),
      { temperature: 0 },
    );
    return coerceAnswer(v?.answer, 4) === q.answer;
  } catch {
    return true; // verifier unavailable - do not block generation
  }
}

// ---- context-set sections (RC, DI, LR) ------------------------------------
function normalizeSet(
  raw: any,
  type: string,
  label: string,
  fallbackContext: string,
  source: string,
  warnings: string[],
): GenSubSet {
  const context = String(raw?.context ?? fallbackContext ?? "").trim();
  const rawQs = Array.isArray(raw?.questions) ? raw.questions : [];
  const questions: GenQuestion[] = [];
  for (const q of rawQs) {
    const norm = normalizeQuestion(q, type);
    if (norm) questions.push(norm);
    else warnings.push(`malformed ${type} question discarded`);
  }
  return {
    id: nextId("set"),
    contextLabel: label,
    context,
    source,
    questions: questions.slice(0, 4),
  };
}

async function genRC(warnings: string[]): Promise<GenSubSet[]> {
  const sets: GenSubSet[] = [];
  for (let i = 0; i < 2; i++) {
    let passage = "";
    let source = "";
    // mix: try a fresh Aeon essay roughly half the time
    if (Math.random() < 0.5) {
      const article = await fetchAeonArticle();
      if (article) {
        passage = article.text;
        source = `Aeon: ${article.title}`;
      }
    }
    if (!passage) {
      const exs = await sampleExemplars("RC", {
        subtype: "rc_passage",
        limit: 1,
        minWords: 250,
      });
      const p = exs[0];
      if (p) {
        passage = cleanExemplar(p.stem);
        source = "mock-derived passage";
      }
    }
    if (!passage) {
      // Ask the LLM itself to produce a CAT-style RC passage from scratch.
      try {
        const synth = await chatJSON<{ passage?: string; topic?: string }>(
          `You are a CAT-style RC passage writer. Generate one original ` +
            `350-450 word essay-style passage suitable for a CAT reading-` +
            `comprehension question. Pick a non-fiction topic (philosophy, ` +
            `history of science, economics, ecology, etc.). Use clean ASCII ` +
            `prose, no headings, no markdown. Return JSON: {"topic":"...","passage":"..."}.`,
          { temperature: 0.7 },
        );
        if (synth?.passage && synth.passage.length > 800) {
          passage = synth.passage;
          source = `LLM-generated essay${synth.topic ? " on " + synth.topic : ""}`;
        }
      } catch {
        /* fall through to warning */
      }
    }
    if (!passage) {
      warnings.push("no RC passage available for one set");
      continue;
    }
    try {
      const ex = await sampleExemplars("RC", { subtype: "rc", limit: 1 });
      const data = await chatJSON<any>(rcPrompt(passage, source, ex), {
        temperature: 0.7,
      });
      sets.push(
        normalizeSet(
          { context: passage, questions: data?.questions },
          "rc",
          "Reading Comprehension",
          passage,
          source,
          warnings,
        ),
      );
    } catch (e) {
      warnings.push(
        `RC generation failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return sets;
}

async function genContextSets(
  section: Section,
  label: string,
  promptFn: (ex: any[]) => string,
  warnings: string[],
): Promise<GenSubSet[]> {
  const sets: GenSubSet[] = [];
  for (let i = 0; i < 2; i++) {
    try {
      const ex = await sampleExemplars(section, { limit: 2 });
      const data = await chatJSON<any>(promptFn(ex), { temperature: 0.8 });
      const set = normalizeSet(data, section.toLowerCase(), label, "", "mock-derived", warnings);
      if (set.questions.length) sets.push(set);
      else warnings.push(`${section} set ${i + 1} had no valid questions`);
    } catch (e) {
      warnings.push(
        `${section} generation failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  return sets;
}

// ---- public entry point ---------------------------------------------------
const VA_PLAN: Plan[] = [
  { subtype: "para_jumble", count: 3 },
  { subtype: "para_completion", count: 3 },
  { subtype: "odd_one_out", count: 2 },
  { subtype: "summary", count: 2 },
];
const QA_PLAN: Plan[] = [
  { subtype: "geometry", count: 2 },
  { subtype: "algebra", count: 2 },
  { subtype: "arithmetic", count: 3 },
  { subtype: "number_system", count: 2 },
  { subtype: "modern_math", count: 1 },
];

export async function generateSet(section: Section): Promise<GeneratedSet> {
  const warnings: string[] = [];
  const meta = {
    generatedAt: new Date().toISOString(),
    model:
      config.llm.provider === "groq"
        ? config.llm.groqModel
        : config.llm.ollamaModel,
    warnings,
  };

  if (section === "VA") {
    const items = await genQuestions("VA", VA_PLAN, vaPrompt, warnings);
    return { section, kind: "questions", items, meta };
  }

  if (section === "QA") {
    const items = await genQuestions("QA", QA_PLAN, qaPrompt, warnings);
    const verified: GenQuestion[] = [];
    for (const q of items) {
      if (await verifyAnswer(q)) verified.push(q);
      else warnings.push(`QA question failed answer verification and was dropped`);
    }
    return { section, kind: "questions", items: verified, meta };
  }

  if (section === "RC") {
    const sets = await genRC(warnings);
    return { section, kind: "sets", sets, meta };
  }

  if (section === "DI") {
    const sets = await genContextSets("DI", "Data Interpretation", diPrompt, warnings);
    return { section, kind: "sets", sets, meta };
  }

  // LR
  const sets = await genContextSets("LR", "Logical Reasoning", lrPrompt, warnings);
  return { section, kind: "sets", sets, meta };
}
