#!/usr/bin/env python3
"""Build the human-readable ingestion report."""
import json
from collections import Counter, defaultdict

OUT = "/sessions/exciting-clever-brown/mnt/outputs/extracted"
TODAY = "2026-05-25"

m = json.load(open(OUT + "/manifest.json"))
st = Counter(e["status"] for e in m.values())

def is_junk(r):
    rl = r.lower()
    return (rl.endswith("_ds_store") or r.endswith("/js")
            or ".download" in r or "test-video-player.html" in r)

ocr  = sorted(k for k, e in m.items() if e["status"] == "needs_ocr")
fail = [k for k, e in m.items() if e["status"] == "failed"]
fail_junk = [k for k in fail if is_junk(k)]
fail_real = sorted(k for k in fail if not is_junk(k))
ignored_total = st["ignored"] + len(fail_junk)

prov = defaultdict(lambda: [0, 0])
for k, e in m.items():
    p = k.split("/")[0] if "/" in k else "(root)"
    if e["status"] == "ok":        prov[p][0] += 1
    if e["status"] == "needs_ocr": prov[p][1] += 1

L = []
L.append("# Mocks Folder - Ingestion Report")
L.append("")
L.append(f"> CAT Mock Generator project, Step 1 (ingestion). Generated {TODAY}.")
L.append("")
L.append("## Summary")
L.append("")
L.append("| Outcome | Files | Meaning |")
L.append("|---|---|---|")
L.append(f"| Extracted OK | {st['ok']} | Text fully extracted and turned into a "
         f"templatized document under `docs/` |")
L.append(f"| Needs OCR | {st['needs_ocr']} | Scanned image-only PDFs - require "
         f"the OCR batch run |")
L.append(f"| Ignored (junk) | {ignored_total} | Web assets, system files, "
         f"JS/CSS/images - no question content |")
L.append(f"| Failed (real content) | {len(fail_real)} | Genuine content files "
         f"that could not be read |")
L.append(f"| **TOTAL** | **{len(m)}** | |")
L.append("")
L.append("## Per-provider coverage")
L.append("")
L.append("| Provider | Extracted OK | Awaiting OCR |")
L.append("|---|---|---|")
for p, (o, c) in sorted(prov.items()):
    L.append(f"| {p} | {o} | {c} |")
L.append("")
L.append("## Files that need OCR (scanned image PDFs)")
L.append("")
total_pg = sum(m[k]["pages"] for k in ocr)
L.append(f"{len(ocr)} files, {total_pg} pages total - almost entirely TIME 2023 "
         f"section papers that were saved as page images. OCR runs at roughly "
         f"14 seconds per page on a CPU, so the full batch is about 9 hours and "
         f"must run as a dedicated job (use `ocr.py`, which is resumable).")
L.append("")
for k in ocr:
    L.append(f"- `{k}`  ({m[k]['pages']} pg)")
L.append("")
L.append("## Files that genuinely FAILED - need your attention")
L.append("")
if fail_real:
    for k in fail_real:
        L.append(f"- `{k}` - {m[k]['note']}")
    L.append("")
    L.append("`1000_RC.doc` is an old-format Word document. The companion "
             "`1000_RC.pdf` (1,025 pages) extracted perfectly, so this `.doc` "
             "is very likely a duplicate of the same content and is not a real "
             "loss - but it is flagged here for confirmation.")
else:
    L.append("None.")
L.append("")
L.append("## Ignored as junk (no action needed)")
L.append("")
L.append(f"{ignored_total} files: saved web-page assets (jQuery, MathJax, CSS, "
         f"images, fonts), macOS `_DS_Store` files, and stray `.js` / "
         f"`.download` files. None of these contain question content.")
L.append("")

open(OUT + "/ingestion_report.md", "w", encoding="utf-8").write("\n".join(L))
print("ingestion_report.md written")
print(f"OK={st['ok']} needs_ocr={st['needs_ocr']} ignored={ignored_total} "
      f"failed_real={len(fail_real)}")
