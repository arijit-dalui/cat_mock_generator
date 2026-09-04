/**
 * Exam-format constants shared by server routes and client components.
 * No Node built-ins here — this file is imported from "use client" code.
 */

/** CAT 2024+ sectional time limit, in minutes. Same for every section. */
export const SECTION_DURATION_MIN = 40;

/** Epoch ms when a section attempt started at `createdAt` must auto-submit.
 * `createdAt` comes from SQLite's datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC,
 * no timezone suffix) or Postgres's now() (ISO, has an offset). Without a
 * suffix, JS parses the string as local time instead of UTC — force UTC so
 * the deadline doesn't drift by the server's UTC offset. */
export function sectionDeadline(createdAt: string): number {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(createdAt)
    ? createdAt
    : createdAt.replace(" ", "T") + "Z";
  return new Date(iso).getTime() + SECTION_DURATION_MIN * 60_000;
}
