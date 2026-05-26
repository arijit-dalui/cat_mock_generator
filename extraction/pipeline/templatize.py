#!/usr/bin/env python3
"""
Step 1 final stage: turn each extracted raw-text file into a TEMPLATIZED
markdown document holding metadata + detected structure + parsed
questions/sets/solutions/explanations + full raw content fallback.
Also builds INDEX.md and ingestion_report.(md|csv).
"""
import os, re, json, datetime, csv

OUT   = "/sessions/exciting-clever-brown/mnt/outputs/extracted"
RAW   = os.path.join(OUT, "raw")
DOCS  = os.path.join(OUT, "docs")
MANIFEST = os.path.join(OUT, "manifest.json")
TODAY = "2026-05-25"

os.makedirs(DOCS, exist_ok=True)

# ---- detection regexes -------------------------------------------------
RE_Q        = re.compile(r"(?m)^\s*Q\s*\.?\s*(\d{1,3})\b")
RE_QNUM     = re.compile(r"(?m)^\s*(\d{1,3})\s*[\.\)]\s")
RE_DIR      = re.compile(r"(?i)directions?\s+for\s+question[s]?\s+\d+\s*(?:to|[-–])\s*\d+")
RE_OPT      = re.compile(r"(?m)^\s*[\(\[]?([A-Da-d1-5])[\)\].]?\s*$")
RE_CORRECT  = re.compile(r"(?i)correct\s+answer\s*[:\-]?\s*([A-Da-d1-5])")
RE_SOL      = re.compile(r"(?i)^\s*(solution|explanation|sol)\s*[:\.]")
RE_KEY      = re.compile(r"(?i)answer\s*key")
SECTIONS = {
    "VARC": re.compile(r"(?i)\b(varc|verbal ability|reading comprehension|"
                       r"vrc|verbal\b)"),
    "DILR": re.compile(r"(?i)\b(dilr|data interpretation|logical reasoning|"
                       r"di\s*&\s*lr|lrdi)\b"),
    "QA":   re.compile(r"(?i)\b(quantitative ability|\bquant\b|\bqa\b)\b"),
}

def detect(text):
    secs = [s for s, rx in SECTIONS.items() if rx.search(text)]
    return {
        "sections": secs or ["unlabelled"],
        "directions_blocks": len(RE_DIR.findall(text)),
        "questions": len(RE_Q.findall(text)) or len(RE_QNUM.findall(text)),
        "option_lines": len(RE_OPT.findall(text)),
        "correct_answers": len(RE_CORRECT.findall(text)),
        "answer_key": bool(RE_KEY.search(text)),
        "solutions": len(RE_CORRECT.findall(text)) > 0
                     or bool(re.search(r"(?im)^\s*solution\s*:", text)),
    }

def parse_questions(text):
    """Best-effort: split on 'Q.N' markers (the Career Launcher pattern)."""
    marks = list(RE_Q.finditer(text))
    if len(marks) < 2:
        return []
    items = []
    for i, m in enumerate(marks):
        start = m.start()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        block = text[start:end]
        num = m.group(1)
        corr = RE_CORRECT.search(block)
        # split stem/options/solution
        sol_m = re.search(r"(?i)\n\s*solution\s*:", block)
        sol = ""
        body = block
        if sol_m:
            sol = block[sol_m.end():].strip()
            body = block[:sol_m.start()]
        opts = [l.strip() for l in body.splitlines()
                if RE_OPT.match(l.strip()) is None and l.strip()]
        items.append({
            "num": num,
            "block": block.strip(),
            "correct": corr.group(1) if corr else None,
            "has_solution": bool(sol),
        })
    return items

def annotate(text):
    """Promote structural lines to markdown so the doc is readable."""
    out = []
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            out.append("")
            continue
        if RE_DIR.search(s):
            out.append(f"\n#### {s}\n")
        elif RE_Q.match(s):
            out.append(f"\n**{s}**")
        elif RE_CORRECT.search(s):
            out.append(f"\n> **{s}**")
        elif RE_SOL.match(s):
            out.append(f"\n_{s}_")
        elif RE_KEY.search(s) and len(s) < 40:
            out.append(f"\n##### {s}")
        else:
            out.append(s)
    return "\n".join(out)

PROVIDER = lambda rel: rel.split("/")[0] if "/" in rel else "(root)"
TYPE_LABEL = {
    "pdf_text": "Clean-text PDF", "webpage_pdf_cleaned": "Saved-webpage PDF",
    "html_strip": "Saved exam-portal HTML", "ocr": "Scanned PDF (OCR)",
}

def build_doc(rel, entry, text):
    d = detect(text)
    qs = parse_questions(text)
    title = os.path.basename(rel)
    md = []
    md.append(f"# {title}")
    md.append(f"> Templatized extraction for the CAT Mock Generator knowledge "
              f"base. Generated {TODAY}.\n")
    md.append("## File metadata\n")
    md.append("| Field | Value |")
    md.append("|---|---|")
    md.append(f"| Source file | `{rel}` |")
    md.append(f"| Provider | {PROVIDER(rel)} |")
    md.append(f"| File type | {TYPE_LABEL.get(entry['method'], entry['method'])} |")
    md.append(f"| Pages | {entry.get('pages', 0)} |")
    md.append(f"| Extraction method | {entry['method']} |")
    md.append(f"| Extraction status | {entry['status']} |")
    md.append(f"| Extracted characters | {entry['chars']:,} |")
    if entry.get("note"):
        md.append(f"| Notes | {entry['note']} |")
    md.append("")
    md.append("## Detected structure\n")
    md.append(f"- Sections present: **{', '.join(d['sections'])}**")
    md.append(f"- Reading-comprehension / 'Directions' blocks: **{d['directions_blocks']}**")
    md.append(f"- Numbered questions detected: **{d['questions']}**")
    md.append(f"- Answer options detected: **{d['option_lines']}**")
    md.append(f"- Explicit 'Correct Answer' markers: **{d['correct_answers']}**")
    md.append(f"- Answer key present: **{'yes' if d['answer_key'] else 'no'}**")
    md.append(f"- Solutions / explanations present: "
              f"**{'yes' if d['solutions'] else 'no'}**")
    md.append("")
    if qs:
        with_sol = sum(1 for q in qs if q["has_solution"])
        with_ans = sum(1 for q in qs if q["correct"])
        md.append(f"## Parsed questions ({len(qs)} found, {with_ans} with a "
                  f"marked answer, {with_sol} with a worked solution)\n")
        md.append("_Best-effort structured parse. Each block keeps the question "
                  "stem, options, worked solution and correct answer exactly as "
                  "in the source._\n")
        for q in qs:
            md.append(f"### Question {q['num']}"
                      + (f"  ·  Correct answer: **{q['correct']}**"
                         if q['correct'] else ""))
            md.append("")
            md.append("```")
            md.append(q["block"])
            md.append("```")
            md.append("")
    md.append("## Full extracted content\n")
    md.append("_Complete cleaned text from the source file, with structural "
              "lines highlighted._\n")
    md.append(annotate(text))
    md.append("")
    return "\n".join(md)

def main():
    with open(MANIFEST) as f:
        manifest = json.load(f)
    index_rows, report_rows = [], []
    n_docs = 0
    for rel in sorted(manifest):
        e = manifest[rel]
        report_rows.append((rel, e["ext"], e["status"], e["method"],
                            e.get("pages", 0), e["chars"], e.get("note", "")))
        if e["status"] != "ok":
            continue
        rawp = os.path.join(RAW, rel + ".txt")
        if not os.path.exists(rawp):
            continue
        text = open(rawp, encoding="utf-8").read()
        doc = build_doc(rel, e, text)
        outp = os.path.join(DOCS, rel + ".md")
        os.makedirs(os.path.dirname(outp), exist_ok=True)
        with open(outp, "w", encoding="utf-8") as f:
            f.write(doc)
        d = detect(text)
        index_rows.append((rel, PROVIDER(rel), e["method"], e["chars"],
                          d["questions"], d["solutions"]))
        n_docs += 1

    # ---- INDEX.md ----
    idx = ["# Templatized Mock Extraction - Index",
           f"> Generated {TODAY}. One templatized document per readable source "
           f"file, under `docs/` mirroring the original `mocks` folder.\n",
           f"**{n_docs} templatized documents** produced.\n",
           "| Document | Provider | Type | Chars | Questions | Solutions |",
           "|---|---|---|---|---|---|"]
    for rel, prov, meth, chars, nq, sol in index_rows:
        idx.append(f"| `docs/{rel}.md` | {prov} | {meth} | {chars:,} | "
                   f"{nq} | {'yes' if sol else 'no'} |")
    with open(os.path.join(OUT, "INDEX.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(idx))

    # ---- ingestion_report.csv ----
    with open(os.path.join(OUT, "ingestion_report.csv"), "w", newline="",
              encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "ext", "status", "method", "pages", "chars", "note"])
        w.writerows(report_rows)

    print(f"templatized {n_docs} documents -> docs/")
    print(f"index + ingestion_report written")

if __name__ == "__main__":
    main()
