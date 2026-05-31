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
/** Coerce the LLM's "answer" field to a 0-based option index. Accepts:
 *   - integers (treated 0-based if 0..N-1, else 1-based if 1..N)
 *   - letters "A"/"a"/.../"D"/"d"
 *   - strings like "Option B" or "(C)"
 * Returns null when we cannot confidently decide — caller can drop the
 * question rather than silently default to A (which used to mask key bugs). */
function coerceAnswer(a: unknown, optionCount: number): number | null {
  if (typeof a === "number") {
    const n = Math.floor(a);
    if (n >= 0 && n < optionCount) return n;
    if (n >= 1 && n <= optionCount) return n - 1;
    return null;
  }
  if (typeof a === "string") {
    const s = a.trim();
    // bare letter, e.g. "B"
    const m = s.match(/^[\(\[]?\s*([A-Da-d])\s*[\)\]\.\:]?$/);
    if (m) return m[1].toUpperCase().charCodeAt(0) - 65;
    // "option B", "answer is C"
    const m2 = s.match(/\b(?:option|answer|choice)\s*[:\-]?\s*([A-Da-d])\b/i);
    if (m2) return m2[1].toUpperCase().charCodeAt(0) - 65;
    // bare integer
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (n >= 0 && n < optionCount) return n;
      if (n >= 1 && n <= optionCount) return n - 1;
    }
    // single-char fallback
    if (s.length === 1) {
      const letter = s.toUpperCase().charCodeAt(0) - 65;
      if (letter >= 0 && letter < optionCount) return letter;
    }
  }
  return null;
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
  // Drop questions whose answer key we couldn't parse — silently defaulting
  // to A used to ship junk to users (red/green swapped, wrong score).
  if (answer === null) return null;
  const explanations = coerceExplanations(
    raw.explanations ?? raw.explanation ?? raw.optionExplanations,
    4,
  ).map(cleanQuestionText);
  const solution = cleanQuestionText(
    String(raw.solution ?? raw.working ?? raw.reasoning ?? "").trim(),
  );
  // Sanity check: if the solution text names a single option letter clearly
  // and it disagrees with `answer`, trust the solution working (the LLM more
  // often emits the right letter inside its prose than in the JSON field).
  const lettered = /\b(?:answer|correct option|hence|therefore)\s*(?:is|:)?\s*\(?([A-D])\)?/i.exec(
    solution,
  );
  let finalAnswer = answer;
  if (lettered) {
    const fromSol = lettered[1].toUpperCase().charCodeAt(0) - 65;
    if (fromSol !== answer) finalAnswer = fromSol;
  }
  // Strongest cross-check: per-option explanations. Writers reliably prefix the
  // correct option's explanation with "Correct" and the others with "Incorrect".
  // If EXACTLY ONE explanation is so labelled and it disagrees with the current
  // answer, trust it. This catches the off-by-one / 1-based-index key bug where
  // the stored `answer` lands one option past the truly-correct one.
  const correctByExp = explanations.reduce<number[]>((acc, e, i) => {
    if (/^\s*correct\b/i.test(e)) acc.push(i);
    return acc;
  }, []);
  if (correctByExp.length === 1 && correctByExp[0] !== finalAnswer) {
    finalAnswer = correctByExp[0];
  }
  return {
    id: nextId("q"),
    type,
    prompt,
    options,
    answer: finalAnswer,
    explanations,
    solution,
  };
}

// ---- standalone-question sections (VA, QA) --------------------------------
interface Plan {
  subtype: string;
  count: number;
}

/** Sleep between Groq calls to stay under free-tier RPM/TPM limits.
 * Groq's free tier on llama-3.3-70b: ~12K TPM, 30 RPM.
 * Our prompts are ~1500-2000 tokens; pacing 6s between calls = 10/min,
 * well under both limits. Combined with chat()-level Retry-After backoff. */
const PACE_MS = 6000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function genQuestions(
  section: Section,
  plan: Plan[],
  promptFn: (subtype: string, count: number, ex: any[]) => string,
  warnings: string[],
): Promise<GenQuestion[]> {
  const items: GenQuestion[] = [];
  for (const [stepIdx, step] of plan.entries()) {
    if (stepIdx > 0) await sleep(PACE_MS);
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

/** Re-solve a question independently; returns true if the answer holds.
 * `context` (e.g. a DI table / LR scenario) is prepended so the verifier has
 * the data it needs to recompute the answer. */
async function verifyAnswer(q: GenQuestion, context?: string): Promise<boolean> {
  try {
    const prompt =
      context && context.trim() ? `${context.trim()}\n\n${q.prompt}` : q.prompt;
    const v = await chatJSON<{ answer?: unknown }>(
      verifyPrompt(prompt, q.options),
      { temperature: 0 },
    );
    const verified = coerceAnswer(v?.answer, 4);
    return verified === null || verified === q.answer;
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

// ---- RC passage de-duplication --------------------------------------------
// A small stopword list so the similarity signature is driven by content
// words, not grammar. Two passages on the same subject share most content
// words even when their opening sentences differ.
const RC_STOPWORDS = new Set(
  ("the a an and or but of to in on at for with by from as is are was were be " +
    "been being this that these those it its their his her our your my we you " +
    "they he she them us him not no nor so than then there here which who whom " +
    "whose what when where why how all any both each few more most other some " +
    "such only own same too very can will just into over under about between " +
    "through during before after above below up down out off again further")
    .split(/\s+/),
);

/** Content-word set for a passage: lowercased, punctuation-stripped, stopwords
 * and short tokens removed. Used to measure topical overlap between passages. */
function passageSignature(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !RC_STOPWORDS.has(w)),
  );
}

/** Jaccard overlap of two content-word sets (0 = disjoint, 1 = identical). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Normalised opening of a passage, for an exact near-prefix comparison. */
function normHead(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
}

// Curated, deliberately-spread topics for the LLM synth fallback. When a
// passage must be generated, we pick one NOT already used this set and tell
// the model to avoid the others, guaranteeing the two passages differ.
const RC_TOPICS = [
  "behavioural economics and how people make financial choices",
  "marine biology and the ecology of deep-ocean ecosystems",
  "the philosophy of language and meaning",
  "urban architecture and the planning of modern cities",
  "the history of cartography and mapmaking",
  "the cognitive neuroscience of human memory",
  "the evolution of classical music as an art form",
  "the anthropology of food and cuisine across cultures",
  "renewable energy policy and the economics of the energy transition",
  "the sociology of social media and online communities",
  "evolutionary biology and natural selection",
  "the ethics and governance of artificial intelligence",
  "ancient trade routes and the exchange of goods and ideas",
  "the psychology of human decision-making",
  "climate science and the study of past climates",
  "the economics of labour markets and work",
];

async function genRC(warnings: string[]): Promise<GenSubSet[]> {
  const sets: GenSubSet[] = [];
  const usedPassages: string[] = [];
  const usedSigs: Set<string>[] = [];
  const usedTopics: string[] = [];

  // A candidate is a near-duplicate if its opening matches a prior passage OR
  // it shares more than 45% of its content words with one. The Jaccard check
  // catches the "two essays on the same subject, different first sentence"
  // case that the old 200-char-prefix test let slip through.
  const isDuplicate = (p: string): boolean => {
    const head = normHead(p);
    const sig = passageSignature(p);
    return usedPassages.some(
      (u, idx) => normHead(u) === head || jaccard(usedSigs[idx], sig) > 0.45,
    );
  };

  // LLM-synthesised passage, forced onto a fresh topic and told to avoid the
  // ones already used so the two passages can never collide topically.
  const synthPassage = async (): Promise<{ passage: string; source: string; topic: string } | null> => {
    const available = RC_TOPICS.filter((t) => !usedTopics.includes(t));
    const pool = available.length ? available : RC_TOPICS;
    const topic = pool[Math.floor(Math.random() * pool.length)];
    const avoid = usedTopics.length
      ? ` This passage MUST be on a completely different subject from the ` +
        `following already-used topics, so do not write about any of them: ` +
        `${usedTopics.join("; ")}.`
      : "";
    try {
      const synth = await chatJSON<{ passage?: string; topic?: string }>(
        `You are a CAT-style RC passage writer. Write one original 350-450 ` +
          `word essay-style passage suitable for a CAT reading-comprehension ` +
          `question, strictly about: ${topic}.${avoid} Use clean ASCII prose, ` +
          `no headings, no markdown. Return JSON: {"topic":"...","passage":"..."}.`,
        { temperature: 0.85 },
      );
      if (synth?.passage && synth.passage.length > 400) {
        return {
          passage: synth.passage,
          source: `LLM-generated essay on ${topic}`,
          topic,
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  };

  // Acquire one passage that is NOT a duplicate of those already used:
  // Aeon (2 tries) -> KB exemplars -> forced-distinct LLM synth.
  const acquire = async (): Promise<{ passage: string; source: string; topic?: string } | null> => {
    for (let a = 0; a < 2; a++) {
      const article = await fetchAeonArticle();
      if (article && !isDuplicate(article.text)) {
        return { passage: article.text, source: `Aeon: ${article.title}`, topic: article.title };
      }
    }
    const exs = await sampleExemplars("RC", {
      subtype: "rc_passage",
      limit: 8,
      minWords: 250,
    });
    for (const e of exs) {
      const cleaned = cleanExemplar(e.stem);
      if (!isDuplicate(cleaned)) {
        return { passage: cleaned, source: "mock-derived passage" };
      }
    }
    return await synthPassage();
  };

  for (let i = 0; i < 2; i++) {
    if (i > 0) await sleep(PACE_MS);
    const got = await acquire();
    if (!got || !got.passage) {
      warnings.push("no RC passage available for one set");
      continue;
    }
    if (isDuplicate(got.passage)) {
      // Last resort: force a synth on a guaranteed-fresh topic.
      const forced = await synthPassage();
      if (!forced || isDuplicate(forced.passage)) {
        warnings.push("RC duplicate passage rejected");
        continue;
      }
      got.passage = forced.passage;
      got.source = forced.source;
      got.topic = forced.topic;
    }
    usedPassages.push(got.passage);
    usedSigs.push(passageSignature(got.passage));
    if (got.topic) usedTopics.push(got.topic);
    try {
      const ex = await sampleExemplars("RC", { subtype: "rc", limit: 1 });
      const data = await chatJSON<any>(rcPrompt(got.passage, got.source, ex), {
        temperature: 0.7,
      });
      sets.push(
        normalizeSet(
          { context: got.passage, questions: data?.questions },
          "rc",
          "Reading Comprehension",
          got.passage,
          got.source,
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
    if (i > 0) await sleep(PACE_MS);
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
    for (const [vi, q] of items.entries()) {
      if (vi > 0) await sleep(4000);
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
    // DI keys are arithmetic; independently re-solve each question against its
    // own table and drop ones the verifier confidently disagrees with. This
    // kills the "table says 70 but the key computed with 60" inconsistency bug.
    let verifyCalls = 0;
    for (const set of sets) {
      const kept: GenQuestion[] = [];
      for (const q of set.questions) {
        if (verifyCalls > 0) await sleep(4000);
        verifyCalls += 1;
        if (await verifyAnswer(q, set.context)) kept.push(q);
        else warnings.push("DI question failed answer verification and was dropped");
      }
      set.questions = kept;
    }
    return { section, kind: "sets", sets, meta };
  }

  // LR
  const sets = await genContextSets("LR", "Logical Reasoning", lrPrompt, warnings);
  return { section, kind: "sets", sets, meta };
}
