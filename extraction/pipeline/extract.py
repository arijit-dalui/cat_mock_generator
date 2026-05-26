#!/usr/bin/env python3
"""
CAT mocks ingestion pipeline - Step 1.
Classifies every file in the mocks folder, extracts text from readable files,
flags scanned PDFs for OCR, records failures. Resumable: skips files already
present in manifest.json.
"""
import os, re, json, sys, traceback, hashlib

MOCKS = "/sessions/exciting-clever-brown/mnt/wish/mocks"
OUT   = "/sessions/exciting-clever-brown/mnt/outputs/extracted"
RAW   = os.path.join(OUT, "raw")          # raw extracted text, mirrors mocks tree
MANIFEST = os.path.join(OUT, "manifest.json")

os.makedirs(RAW, exist_ok=True)

import fitz  # PyMuPDF
from bs4 import BeautifulSoup

IGNORE_EXT = {".js", ".css", ".download", ".png", ".jpg", ".jpeg", ".gif",
              ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".map"}
JUNK_NAMES = {".ds_store", "thumbs.db"}

def load_manifest():
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as f:
            return json.load(f)
    return {}

def save_manifest(m):
    tmp = MANIFEST + ".tmp"
    with open(tmp, "w") as f:
        json.dump(m, f, indent=1)
    os.replace(tmp, MANIFEST)

def clean_text(t):
    t = t.replace("\x00", " ")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()

def is_webpage_pdf(t):
    markers = [".jsp", "qsetId", "procreview", "AccSelectGraph", "Exam Portal",
               "TimeAnalysis.jsp", "QsAnalysis"]
    hits = sum(1 for m in markers if m in t)
    return hits >= 2

def strip_webpage_noise(t):
    # remove jsp link fragments and obvious portal nav lines
    t = re.sub(r"\([A-Za-z]+\.jsp\?[^\)]*\)", " ", t)
    t = re.sub(r"[A-Za-z]+\.jsp\?[^\s]*", " ", t)
    lines = []
    for ln in t.splitlines():
        s = ln.strip()
        low = s.lower()
        if not s:
            lines.append("")
            continue
        if low in ("scorecard", "accuracy", "time analysis", "qs analysis",
                   "vrc", "varc", "di & lr", "quant", "mock analysis"):
            lines.append(s)
            continue
        if re.match(r"^\d{1,2}/\d{1,2}/\d{2,4}.*(am|pm)$", low):
            continue  # timestamp line
        lines.append(s)
    return clean_text("\n".join(lines))

def extract_pdf(path):
    """returns (status, method, pages, text, note)"""
    try:
        doc = fitz.open(path)
    except Exception as e:
        return ("failed", "none", 0, "", f"cannot open PDF: {e}")
    pages = doc.page_count
    parts, img_pages = [], 0
    try:
        for pg in doc:
            txt = pg.get_text("text") or ""
            parts.append(txt)
            if len(txt.strip()) < 20 and pg.get_images():
                img_pages += 1
    except Exception as e:
        doc.close()
        return ("failed", "pymupdf", pages, "", f"page extraction error: {e}")
    doc.close()
    full = "".join(parts)
    chars = len(full.strip())
    avg = chars / max(pages, 1)
    if chars < 200 or avg < 25:
        # almost no text -> scanned/image PDF
        return ("needs_ocr", "pending", pages, "",
                f"image-only PDF ({pages} pages, {chars} text chars) - OCR required")
    if is_webpage_pdf(full):
        return ("ok", "webpage_pdf_cleaned", pages, strip_webpage_noise(full),
                "saved-webpage PDF: portal/JSP noise stripped")
    return ("ok", "pdf_text", pages, clean_text(full), "")

def extract_html(path):
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            html = f.read()
    except Exception as e:
        return ("failed", "none", 0, "", f"cannot read HTML: {e}")
    try:
        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "noscript", "head", "link", "meta"]):
            tag.decompose()
        txt = soup.get_text("\n")
    except Exception as e:
        return ("failed", "bs4", 0, "", f"HTML parse error: {e}")
    txt = clean_text(txt)
    if len(txt) < 80:
        return ("failed", "html_strip", 0, txt, f"HTML yielded only {len(txt)} chars")
    return ("ok", "html_strip", 0, txt, "")

def classify(path):
    name = os.path.basename(path).lower()
    ext = os.path.splitext(name)[1]
    rel = os.path.relpath(path, MOCKS)
    if name in JUNK_NAMES or name.startswith("._"):
        return ("ignored", "junk system file")
    # web asset folders saved next to portal HTML
    if "_files/" in rel.replace("\\", "/") or rel.replace("\\", "/").endswith("_files"):
        if ext in IGNORE_EXT or ext == "":
            return ("ignored", "saved web-page asset")
    if ext in IGNORE_EXT:
        return ("ignored", f"non-content asset ({ext or 'no ext'})")
    if ext == ".pdf":
        return ("pdf", "")
    if ext in (".html", ".htm"):
        return ("html", "")
    if ext == ".doc":
        return ("other", ".doc not handled by this pass")
    return ("other", f"unhandled type {ext or 'no ext'}")

def main():
    budget = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
    manifest = load_manifest()
    allfiles = []
    for root, _, files in os.walk(MOCKS):
        for fn in files:
            allfiles.append(os.path.join(root, fn))
    allfiles.sort()
    done = 0
    for path in allfiles:
        rel = os.path.relpath(path, MOCKS)
        if rel in manifest:
            continue
        if done >= budget:
            break
        entry = {"rel": rel, "ext": os.path.splitext(path)[1].lower(),
                 "size": os.path.getsize(path)}
        kind, reason = classify(path)
        try:
            if kind == "ignored":
                entry.update(status="ignored", method="none", pages=0,
                             chars=0, note=reason)
            elif kind == "pdf":
                st, meth, pg, txt, note = extract_pdf(path)
                entry.update(status=st, method=meth, pages=pg,
                             chars=len(txt), note=note)
                if txt:
                    op = os.path.join(RAW, rel + ".txt")
                    os.makedirs(os.path.dirname(op), exist_ok=True)
                    with open(op, "w", encoding="utf-8") as f:
                        f.write(txt)
            elif kind == "html":
                st, meth, pg, txt, note = extract_html(path)
                entry.update(status=st, method=meth, pages=0,
                             chars=len(txt), note=note)
                if txt:
                    op = os.path.join(RAW, rel + ".txt")
                    os.makedirs(os.path.dirname(op), exist_ok=True)
                    with open(op, "w", encoding="utf-8") as f:
                        f.write(txt)
            else:
                entry.update(status="failed", method="none", pages=0,
                             chars=0, note=reason)
        except Exception as e:
            entry.update(status="failed", method="none", pages=0, chars=0,
                         note=f"unexpected: {e} | {traceback.format_exc()[-200:]}")
        manifest[rel] = entry
        done += 1
        if done % 50 == 0:
            save_manifest(manifest)
            print(f"  processed {done} ...", flush=True)
    save_manifest(manifest)
    print(f"DONE this run: {done} files. total in manifest: {len(manifest)}")

if __name__ == "__main__":
    main()
