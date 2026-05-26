/**
 * Knowledge-base retrieval. The generation engine pulls exemplars from here
 * as style references, and uses the similarity check to make sure a freshly
 * generated item is not too close to a real mock question.
 */
import { db } from "./db";
import { textSimilarity } from "./llm";

export interface KbItem {
  id: number;
  section: string;
  subtype: string | null;
  source_file: string | null;
  stem: string;
  options: string | null;
  answer: string | null;
  solution: string | null;
  word_count: number | null;
}

/** Random exemplars for a section (optionally a specific subtype). */
export function sampleExemplars(
  section: string,
  opts: { subtype?: string; limit?: number; minWords?: number; maxWords?: number } = {},
): KbItem[] {
  const limit = opts.limit ?? 5;
  const where: string[] = ["section = ?"];
  const params: unknown[] = [section];
  if (opts.subtype) {
    where.push("subtype = ?");
    params.push(opts.subtype);
  }
  if (opts.minWords != null) {
    where.push("word_count >= ?");
    params.push(opts.minWords);
  }
  if (opts.maxWords != null) {
    where.push("word_count <= ?");
    params.push(opts.maxWords);
  }
  params.push(limit);
  return db
    .prepare(
      `SELECT * FROM kb_items WHERE ${where.join(" AND ")}
       ORDER BY RANDOM() LIMIT ?`,
    )
    .all(...params) as KbItem[];
}

/** Spread a sample across several subtypes (used for the mixed VA/QA sets). */
export function sampleAcrossSubtypes(
  section: string,
  subtypes: string[],
  perSubtype: number,
): KbItem[] {
  const out: KbItem[] = [];
  for (const st of subtypes) out.push(...sampleExemplars(section, { subtype: st, limit: perSubtype }));
  return out;
}

/** Counts per subtype - handy for the admin view and for generation balancing. */
export function subtypeCounts(section: string): Record<string, number> {
  const rows = db
    .prepare(
      "SELECT subtype, COUNT(*) c FROM kb_items WHERE section = ? GROUP BY subtype",
    )
    .all(section) as { subtype: string; c: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.subtype] = r.c;
  return out;
}

/**
 * Highest word-overlap similarity between `text` and a random sample of real
 * mock items in the section. Used as an anti-plagiarism guard - a generated
 * item scoring above ~0.6 is too close to a source question.
 */
export function maxSimilarityToKb(text: string, section: string, sampleSize = 400): number {
  const rows = db
    .prepare(
      "SELECT stem FROM kb_items WHERE section = ? ORDER BY RANDOM() LIMIT ?",
    )
    .all(section, sampleSize) as { stem: string }[];
  let max = 0;
  for (const r of rows) {
    const s = textSimilarity(text, r.stem);
    if (s > max) max = s;
  }
  return max;
}

export const LEAK_THRESHOLD = 0.6;
