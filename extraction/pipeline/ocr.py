#!/usr/bin/env python3
"""
OCR pass for scanned PDFs flagged 'needs_ocr' in manifest.json.
Resumable + page-budgeted: run repeatedly until all done.
  python3 ocr.py <max_pages_this_run> [max_pages_per_file]
Updates manifest entries to status 'ok' (method 'ocr') and writes raw text.
"""
import os, json, sys, time, io

MOCKS = "/sessions/exciting-clever-brown/mnt/wish/mocks"
OUT   = "/sessions/exciting-clever-brown/mnt/outputs/extracted"
RAW   = os.path.join(OUT, "raw")
MANIFEST = os.path.join(OUT, "manifest.json")
DPI = 150

import fitz, pytesseract
from PIL import Image

def main():
    page_budget = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    per_file_cap = int(sys.argv[2]) if len(sys.argv) > 2 else 10**6
    with open(MANIFEST) as f:
        manifest = json.load(f)
    todo = sorted([k for k, v in manifest.items() if v["status"] == "needs_ocr"],
                  key=lambda k: manifest[k]["pages"])
    used = 0
    for rel in todo:
        if used >= page_budget:
            break
        src = os.path.join(MOCKS, rel)
        try:
            doc = fitz.open(src)
        except Exception as e:
            manifest[rel].update(status="failed", note=f"OCR open error: {e}")
            continue
        n = min(doc.page_count, per_file_cap)
        if used + n > page_budget and used > 0:
            break
        parts = []
        t0 = time.time()
        for i in range(n):
            pix = doc[i].get_pixmap(dpi=DPI)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            parts.append(pytesseract.image_to_string(img, config="--oem 1 --psm 6"))
        doc.close()
        text = "\n".join(parts).strip()
        op = os.path.join(RAW, rel + ".txt")
        os.makedirs(os.path.dirname(op), exist_ok=True)
        with open(op, "w", encoding="utf-8") as f:
            f.write(text)
        manifest[rel].update(status="ok", method="ocr", chars=len(text),
                             note=f"OCR {n} pages @ {DPI}dpi")
        used += n
        with open(MANIFEST + ".tmp", "w") as f:
            json.dump(manifest, f, indent=1)
        os.replace(MANIFEST + ".tmp", MANIFEST)
        print(f"  OCR {rel} -> {len(text)} chars, {n}pg, {time.time()-t0:.0f}s",
              flush=True)
    remaining = sum(manifest[k]["pages"] for k, v in manifest.items()
                    if v["status"] == "needs_ocr")
    print(f"run done: {used} pages OCR'd. remaining needs_ocr pages: {remaining}")

if __name__ == "__main__":
    main()
