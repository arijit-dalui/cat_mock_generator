/**
 * Shared visual constants/helpers for the exam-style screens (sectional
 * SolveClient and the full-mock MockClient). SolveClient keeps its own
 * copies rather than importing these - it was built and tested first, and
 * there's no reason to risk destabilizing it for the sake of not repeating
 * ~80 lines. New exam-style screens should import from here instead of
 * copy-pasting a third time.
 */

// The live exam screen intentionally renders as a fixed light theme,
// independent of the app's dark-mode toggle - real CAT test-day software
// has no dark mode, and matching it builds the same visual muscle memory.
export const EXAM_COLORS = {
  headerBg: "#1c2b3a",
  headerText: "#e8edf3",
  tabBarBg: "#eef1f5",
  tabActiveBg: "#3f6db0",
  border: "#c7d0da",
  panelBg: "#ffffff",
  paletteBg: "#dce8f5",
  text: "#1a1a1a",
  textMuted: "#5a6472",
  answered: "#3fa84a",
  answeredBg: "#e7f5e9",
  notAnswered: "#d9534f",
  notAnsweredBg: "#fbeceb",
  marked: "#7c4dbe",
  markedBg: "#ece3f7",
  notVisited: "#e2e6ea",
  notVisitedText: "#5a6472",
  primary: "#3f6db0",
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minimal markdown renderer for DI/LR contexts: GFM tables, bold, italic, ` */
export function renderContext(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const inlineFmt = (t: string) =>
    escapeHtml(t)
      .replace(/`([^`]+)`/g, '<code style="background:#f1f3f5;border-radius:3px;padding:0 4px;">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  while (i < lines.length) {
    const ln = lines[i];
    if (ln.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
      const splitRow = (r: string) =>
        r
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = splitRow(ln);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        `<div style="overflow-x:auto"><table style="margin:8px 0;width:100%;border-collapse:collapse;font-size:13px;">` +
          `<thead><tr>` +
          headers
            .map((h) => `<th style="border:1px solid #c7d0da;background:#f1f3f5;padding:6px 10px;text-align:left;font-weight:600;">${inlineFmt(h)}</th>`)
            .join("") +
          `</tr></thead><tbody>` +
          rows
            .map(
              (r) =>
                `<tr>` + r.map((c) => `<td style="border:1px solid #c7d0da;padding:6px 10px;">${inlineFmt(c)}</td>`).join("") + `</tr>`,
            )
            .join("") +
          `</tbody></table></div>`,
      );
      continue;
    }
    if (ln.trim() === "") {
      out.push("");
      i++;
      continue;
    }
    out.push(`<p style="margin:4px 0;">${inlineFmt(ln)}</p>`);
    i++;
  }
  return out.join("\n");
}

/** Some LLM generations forget to include the directional sentence (e.g.
 * odd-one-out prompts that show 5 numbered sentences but no "identify the
 * misfit" instruction). Prepend a fallback when we detect that pattern. */
export function withInstructionFallback(q: { type: string; prompt: string }): string {
  const p = q.prompt;
  if (q.type === "para_jumble" && /^\s*1\.\s/.test(p) && !/arrange|order|sequence/i.test(p.slice(0, 80))) {
    return "Arrange the following sentences in the correct logical order.\n" + p;
  }
  if (q.type === "odd_one_out" && /\b1\.\s/.test(p) && !/misfit|odd one|does not fit|not belong/i.test(p)) {
    return "Five sentences below relate to the same theme. Identify the ONE sentence that does not fit with the others.\n" + p;
  }
  if (q.type === "para_completion" && !/_____|complete the|best completes|fill in the blank/i.test(p)) {
    return "Choose the option that best completes the paragraph below.\n" + p;
  }
  if (q.type === "summary" && !/summari[sz]e|main idea|best capture/i.test(p)) {
    return p + "\nWhich of the following best summarises the paragraph above?";
  }
  return p;
}
