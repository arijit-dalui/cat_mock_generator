# CAT Problem-Set Generator — Build Plan

*Prepared 2026-05-25. Detailed approach for an app that generates fresh CAT-style VARC / DILR / QA sets from a knowledge base built out of the `mocks` folder, using a local LLM, deployable later to a free host.*

---

## 1. What this app is

A web application where:

- Users **register** with a unique name + password and log in.
- The user screen has **5 tabs — VA, RC, DI, LR, QA**. On each tab the user can either **Generate** a fresh set or **browse previously generated** sets.
- Generation produces: **VA** = 10 questions (mix of para-completion, para-jumble, odd-one-out, summary); **RC** = 2 passages × 4 questions; **DI** = 2 sets; **LR** = 2 sets; **QA** = 10 questions (mix of geometry, algebra, arithmetic, modern math, misc).
- An **admin** account (own name + password) sees analytics: who registered, daily active visitors, sets generated, sets solved, per-section breakdown.
- Fresh content every time is powered by a **knowledge base** distilled once from the `mocks` folder, plus a **local LLM** for generation. RC additionally pulls **random Aeon articles** mixed with mock passages.

---

## 2. The `mocks` folder — what we actually have

I scanned the folder. This is the single most important input to the plan, because the files are far messier than "a folder of PDFs."

**Totals:** ~1.3 GB, 143 folders, 1,160 files — 471 PDF, 208 HTML, 222 `.download`, 93 PNG, 65 CSS, 40 JPG, plus `.doc`, `.DS_Store`, etc.

**By provider:** Career Launcher (134 PDF / 105 HTML), IMS (59 PDF / 77 HTML), TIME (254 PDF / 25 HTML).

**The PDFs are not one kind of file — they are at least three:**

1. **Clean text PDFs** — e.g. `Career Launcher/CL 2016/CL MOCK 1.pdf`. `pdftotext` extracts perfect, well-structured text including passages and questions. Easiest source.
2. **Scanned / image-only PDFs** — e.g. `1000_RC.pdf` (1,025 pages) and `TIME/Aimcat 20/AIMCAT 2012.pdf` return **zero extractable text**; they are page images. These need **OCR**. The 1000+ page scans are expensive to process.
3. **Saved-webpage PDFs** — e.g. `CL 2017/Questions/Mock 1 Q.pdf` extracts text but it is polluted with JSP links, timestamps, and portal navigation ("procreview.jsp?qsetId=…"). Needs cleaning before it is usable.

**The HTML files** are saved exam portals (e.g. `Sectional Lrdi/LRDI 1 Exam Portal.html`). The real question content is embedded but wrapped in heavy JavaScript and portal markup — usable only after stripping scripts/tags.

**The `.download` files** (222 of them) are almost entirely **junk** — saved web assets (`jquery.min.js`, `MathJax.js`, `cast_sender.js`). They should be classified as "ignore," not parsed for content.

**Implication:** the ingestion pipeline cannot assume a uniform format. It must **classify every file first**, route each to the right extractor, and **explicitly report every file it cannot read** — which is exactly the requirement you flagged.

> Note: `srs_document.pdf` and `safe heaven.txt` in the `wish` root belong to a different project (a mental-health platform) and are excluded from this app.

---

## 3. Key constraints and the decisions we made

| Topic | Decision | Consequence for the plan |
|---|---|---|
| LLM hardware | 16 GB RAM, **no GPU** | Use a **quantized 7B model on CPU** (slow but fine for async generation). Math correctness from a small CPU model is unreliable → we **must not** trust the LLM for raw arithmetic (see §6). |
| Hosting | **Fully local now**, move to a free host later | Build local-first, but keep every external dependency (LLM, DB) behind an interface so the cloud swap is config-only. |
| Deliverable | This document only | No code yet. This plan is the artifact to review. |
| RC source | **Mix** Aeon + mock passages | RC generator randomly chooses each run between a fresh Aeon essay and a mock-derived passage. |

**Vercel reality check.** Vercel is serverless; it **cannot run a local LLM**, and its Hobby functions time out in ~10–60s while CPU generation takes minutes. So "host on Vercel" really means: Vercel hosts the **app (UI + API)** only; the **LLM and the long-running generation job live elsewhere.** The plan separates those concerns from day one.

**Recommended "later, free" hosting** (so you don't have to decide twice):

- **App (Next.js UI + API):** Vercel free Hobby tier.
- **Database + vector store:** Supabase free tier (Postgres with the `pgvector` extension built in — one database for both relational data and embeddings).
- **LLM, later:** the honest answer is there is **no free always-on GPU host.** Two genuinely free paths:
  - **Groq free API** *(recommended)* — hosts Llama/Qwen-class models, extremely fast, generous free limits, zero infrastructure. Swap Ollama → Groq by changing one config value.
  - **Oracle Cloud "Always Free" ARM VM** (Ampere A1: 4 cores / 24 GB RAM, free forever) running Ollama — truly self-hosted and free, but slower and more setup.
- **Generation worker** (the long job): runs locally now; later runs on the Oracle VM, or as a scheduled/queued job (Inngest or Upstash QStash free tiers).

---

## 4. Tech stack & full software list

**Application**

- **Node.js 20+ and npm** — runtime.
- **Next.js (App Router) + React + TypeScript** — single codebase for UI and API routes; Vercel-native later, runs locally now via `next dev`.
- **Tailwind CSS** — fast, clean UI for the 5-tab dashboard.
- **PostgreSQL** — via **Supabase** (free, works locally and in cloud) or a local Postgres install. Use the **`pgvector`** extension for embeddings so there is only one datastore.
- **Prisma** (or Drizzle) — typed DB access and migrations.
- **bcrypt** + signed session cookies (or **NextAuth**) — registration, unique-username login, admin role.

**Local LLM**

- **Ollama** — local model runtime (simple HTTP API, easy Groq swap later).
- **Model:** **Qwen2.5-7B-Instruct (Q4_K_M)** as primary — strong at instruction-following, JSON output, and math reasoning. **Qwen2.5-3B-Instruct** as a fast fallback for slow runs.
- **Embeddings:** **nomic-embed-text** via Ollama (~280 MB, CPU-fine) for the retrieval knowledge base.

**Ingestion pipeline (separate Python tool — Python's PDF/OCR ecosystem is far stronger than Node's)**

- **Python 3.11+ and pip.**
- **Poppler** (`pdftotext`, `pdfinfo`, `pdfimages`) — text PDFs.
- **PyMuPDF** (`fitz`) — reliable text + layout extraction and per-page image detection.
- **Tesseract OCR** + **ocrmypdf** — scanned/image PDFs.
- **BeautifulSoup4 + lxml** — strip the saved HTML exam portals.
- **trafilatura** (or Mozilla Readability) — clean article extraction for Aeon.
- **pandas** — build the ingestion report.

**Tooling**

- **Git** for version control; **Vercel CLI** for the later deploy.

---

## 5. System architecture

Five components, deliberately decoupled so the LLM and the slow job can move to the cloud independently.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Next.js App    │────▶│  PostgreSQL +    │◀────│  Generation Worker  │
│  UI + API       │     │  pgvector (KB,   │     │  (Node/Python)      │
│  (Vercel later) │◀────│  users, sets,    │     │  - reads KB         │
└─────────────────┘     │  analytics)      │     │  - calls LLM        │
                        └──────────────────┘     │  - validates output │
                                                 │  - fills set pool   │
                                                 └──────────┬──────────┘
                                                            │
                                   ┌────────────────────────┼───────────┐
                                   ▼                        ▼           ▼
                          ┌────────────────┐     ┌──────────────┐  ┌─────────┐
                          │ Ollama (local) │     │ Aeon fetcher │  │ Solver/ │
                          │ → Groq (later) │     │ (RC essays)  │  │ verifier│
                          └────────────────┘     └──────────────┘  └─────────┘

  ONE-TIME / ON-DEMAND:
  ┌──────────────────────────────────────────────────────────────────┐
  │ Ingestion Pipeline (Python) → classifies every mocks file,         │
  │ extracts text, OCRs scans, writes KB to DB, emits ingestion report │
  └──────────────────────────────────────────────────────────────────┘
```

**Why a separate Generation Worker.** Generating 10 questions on a CPU 7B model takes 1–3 minutes — far past any serverless timeout. The worker maintains a **pre-generated pool** of sets per section in the database and replenishes it in the background. When the user clicks **Generate**, the app hands them a ready set instantly and the worker tops the pool back up. This makes the UX fast now *and* works unchanged on Vercel later.

---

## 6. The hard part — generating *correct, fresh* problems

A small CPU LLM will happily produce a geometry question whose answer is wrong, or a logic puzzle with no valid solution. Treating the LLM as the sole author would ship broken problems. The plan uses a **hybrid strategy per section:**

**QA (quant) — template-first.** During ingestion we mine the mocks for recurring **problem templates** (e.g. "mixture/alligation," "time-speed-distance with two bodies," "triangle area from sides"). Each template is encoded as a parameterized generator: random numbers in, **answer and full solution computed in code (sympy)** — so the answer is *always* correct. The LLM is used only to *re-word* the template into natural CAT-style language and to write distractor options. A code check confirms the LLM didn't change the numbers.

**DI — data-driven templates.** Generate the underlying dataset programmatically (tables, charts, caselets with random but consistent numbers), compute every answer in code, then have the LLM phrase the questions. The data is guaranteed self-consistent.

**LR — generate then *verify with a solver*.** LR puzzles (arrangements, groupings, conditions) are generated as constraint sets; a constraint solver (e.g. `python-constraint` / Z3) checks that **exactly one** valid solution exists before the set is accepted. Anything ambiguous or unsolvable is discarded and regenerated.

**VA and RC — LLM-led, this is its strength.** Para-jumbles, para-completion, odd-one-out, summary, and RC question-writing are genuine language tasks. Here we use **retrieval-augmented generation**: pull 3–5 categorized exemplars from the knowledge base as *style references* (never to copy), and prompt the LLM to produce new items in that style. For para-jumbles the "answer" is verifiable by construction (we shuffle a known-correct order).

**Anti-leak check (all sections).** Every generated item is embedding-compared against the knowledge base; if it is too similar to a real mock question, it is rejected. The app generates *fresh* problems, it does not resurface the originals.

---

## 7. Data model (PostgreSQL)

- **users** — id, username (unique), password_hash, role (`user` | `admin`), created_at.
- **login_events** — user_id, timestamp, ip/agent — powers daily-active-visitor counts.
- **kb_items** — the knowledge base: id, section (VA/RC/DI/LR/QA), subtype (e.g. `para_jumble`, `geometry`), source_file, raw_text, structured_json, embedding (`vector`), quality_flag.
- **qa_templates / lr_templates** — parameterized generators mined from `kb_items`.
- **generated_sets** — id, section, payload_json (questions + options + answers + solutions), status (`pooled` | `served`), created_at.
- **set_assignments** — which user got which set, when.
- **attempts** — set_id, user_id, answers, score, solved_at — powers "problems solved" analytics.
- **ingestion_report** — file_path, file_type, status (`ok` | `ocr_used` | `failed` | `ignored`), reason, extracted_chars.
- **app_events** — generic event log (set_generated, set_solved, tab_opened) for the admin dashboard.

---

## 8. Phased build plan

### Phase 0 — Environment setup
Install Node 20, Python 3.11, Poppler, Tesseract, ocrmypdf, Ollama; pull `qwen2.5:7b-instruct` and `nomic-embed-text`. Create a Supabase project (or local Postgres) and enable `pgvector`. Initialize the Next.js + TypeScript repo with Tailwind and Prisma.

### Phase 1 — Ingestion pipeline (the big one)
A standalone Python tool, `ingest/`, with these stages:

1. **Walk & classify** every file under `mocks`. Buckets: clean-text PDF, scanned PDF, saved-webpage PDF, HTML portal, junk asset (`.download`/`.css`/`.js`/`.DS_Store`), image, other.
2. **Route & extract.** Clean PDF → `pdftotext`/PyMuPDF. Scanned PDF → `ocrmypdf` + Tesseract (the 1000+ page scans run last and are checkpointed so a crash doesn't restart them). Saved-webpage PDF → extract then strip JSP/timestamp noise. HTML → BeautifulSoup, drop `<script>`/`<style>`, keep question text. Junk → skip by design.
3. **Read *every* file.** The pipeline iterates the entire tree — no file is silently skipped. A file that fails every extractor (corrupt, encrypted, empty, unknown format) is recorded.
4. **Report back — required step.** Emit `ingestion_report.csv` **and** a human-readable `ingestion_report.md` listing every file, its type, status (`ok` / `ocr_used` / `failed` / `ignored`), and the failure reason for anything unreadable. You review this before generation is trusted. The pipeline prints a summary: "X read OK, Y via OCR, Z failed — see report."
5. **Incremental re-runs.** Hash each file; on re-run, skip unchanged files so you never re-OCR 1,025 pages twice.

### Phase 2 — Knowledge base structuring
Segment extracted text into individual items (one passage, one puzzle, one question). Classify each into section + subtype (rules for obvious cases, the LLM for ambiguous ones). Embed each with `nomic-embed-text` and store in `kb_items`. Mine recurring QA/LR patterns into `qa_templates` / `lr_templates`. Produce a coverage report so you can see, e.g., "geometry: 240 exemplars, 18 templates."

### Phase 3 — Generation engine
Per-section generators implementing §6 (hybrid: templates + solver verification for QA/DI/LR, RAG for VA/RC). Build the **Aeon fetcher** for RC: pull a random essay, extract clean text with trafilatura, trim to CAT word limits (~500–900 words), generate 4 CAT-style questions; the RC generator randomly chooses Aeon vs. mock passage each run. Wrap the LLM behind one interface (`generate()`) so Ollama ↔ Groq is a config switch. Run output through schema validation, the solver/answer check, and the anti-leak similarity check.

### Phase 4 — Web application
Home page with **register** (unique-username enforced) and **login**. User dashboard with the **5 tabs (VA / RC / DI / LR / QA)**, each offering **Generate** (serve a pooled set instantly) and **My sets** (browse past sets, attempt them, see solutions). A clean, distraction-free solving screen with answer submission and scoring.

### Phase 5 — Admin analytics
Admin login routes to an analytics dashboard: total + recent registrations, daily active visitors (from `login_events`), sets generated and solved (overall and per section), most-used tab, pool health. Charts via a light chart library.

### Phase 6 — Quality & verification
Automated checks: every generated QA/DI answer recomputed in code; every LR puzzle re-solved for a unique solution; every set schema-validated; anti-leak similarity below threshold. A manual review screen to spot-check a sample. Unit tests on templates and parsers.

### Phase 7 — Deployment
Deploy the Next.js app to Vercel; move the database to Supabase cloud; point the LLM interface at Groq (or stand up the Oracle Always-Free VM with Ollama); run the generation worker on the VM or via a free queue. Verify the pooled-set flow respects serverless timeouts.

---

## 9. Risks & mitigations

- **OCR cost.** `1000_RC.pdf` (1,025 pages) and similar scans take a long time on CPU. *Mitigation:* checkpoint OCR, run scans last, cache results, never re-OCR unchanged files.
- **Wrong math from the LLM.** *Mitigation:* template-first QA/DI with code-computed answers; the LLM only re-words (§6).
- **Unsolvable/ambiguous LR.** *Mitigation:* constraint-solver verification; reject and regenerate.
- **Slow generation on CPU.** *Mitigation:* pre-generated pool replenished by the background worker; the user never waits on the model.
- **Serverless timeouts on Vercel.** *Mitigation:* the app only reads/writes the DB; all long work is in the worker.
- **Copyright / leakage.** The mocks are third-party. *Mitigation:* the KB is used only as private style reference; the anti-leak check blocks near-duplicates; the app ships *generated* content. Keep this app private/personal unless you clear redistribution rights.
- **Aeon scraping fragility.** *Mitigation:* trafilatura with a fallback parser; if a fetch fails, RC falls back to a mock passage.

---

## 10. Suggested build order

Phase 0 → **Phase 1 (ingestion + the report — review this output before going further)** → Phase 2 → Phase 3 (start with VA/RC, then QA, then DI/LR) → Phase 4 → Phase 5 → Phase 6 → Phase 7.

Phase 1's `ingestion_report.md` is the first real checkpoint: it tells us how much of the 1.3 GB is actually usable and which files (if any) need attention before the knowledge base can be trusted.

---

## 11. Open questions for you

1. **Admin credentials** — fixed in config, or a one-time admin setup screen?
2. **"Solved" definition** — does a set count as solved when all questions are answered, or when submitted regardless of score?
3. **Pool size** — how many ready sets per section should the worker keep buffered (affects how "instant" Generate feels)?
4. **Aeon** — happy with random essays across all topics, or restrict to certain categories (philosophy, science, culture)?
5. **OCR scope** — OCR all scanned PDFs up front (slow, complete), or skip the giant scans initially and add them later?
