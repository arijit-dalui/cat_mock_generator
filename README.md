# CAT Mock Generator

A local-first web app that generates fresh CAT-style problem sets (VA, RC, DI,
LR, QA) on demand. Every set ships with a worked solution and a per-option
explanation; you submit your answers and the app scores you against the
model's answer key.

Built with Next.js + SQLite. Runs on top of any LLM provider — Ollama
locally, Groq's hosted API, or anything OpenAI-compatible you wire in.

---

## What it does

- Five sections, each shaped to match the real CAT pattern:
  - **VA** – 10 questions across para-jumble, para-completion, odd-one-out,
    summary.
  - **RC** – 2 passages × 4 questions. Roughly half the passages are pulled
    fresh from an Aeon essay, half from a knowledge base of past mock
    passages.
  - **DI** – 2 sets, each with a markdown table of concrete numbers + 4
    questions.
  - **LR** – 2 sets, each with a scenario + numbered conditions + 4 questions.
  - **QA** – 10 questions across geometry, algebra, arithmetic, number
    systems, modern math, with an answer-verification re-solve pass.
- A pool worker pre-generates sets in the background so clicking *Generate*
  is instant once the pool fills.
- Per-option explanations + a full worked solution in review mode.
- Local user accounts (SQLite + bcrypt + signed session cookies).

---

## Architecture in one diagram

```
                  +-----------------------+
  browser <-----> | Next.js app           |  <----+
                  | (pages + API routes)  |       |
                  +-----------------------+       |
                          |                        |
                          v                        |
                  +-----------------------+       |
                  | SQLite (cat.db)       |       |
                  |  users, sessions,     |       |
                  |  kb_items,            |       |
                  |  generated_sets,      |       |
                  |  attempts, events     |       |
                  +-----------------------+       |
                                                   |
                  +-----------------------+       |
                  | Worker (scripts/      |--POST-+  (internal/topup)
                  |  worker.mjs)          |       |
                  | tops up the set pool  |       |
                  +-----------------------+       |
                          ^                        |
                          | reads pool count       |
                          | from cat.db            |
                          |                        |
                  +-----------------------+       |
                  | LLM provider          | <-----+ (chatJSON / embed)
                  |  Ollama (local) OR    |
                  |  Groq (hosted)        |
                  +-----------------------+
```

`extraction/docs` (not in this repo — too large) is a corpus of templatized
past mock papers. The provided `build-kb` script chunks them into 28k
question exemplars + 2k RC passages and stores them in `kb_items`. The
generation engine samples from this knowledge base for *style*, never for
content — every shipped question is freshly generated.

---

## Quick start

You need three things installed: **Node 20+**, **Ollama**
(https://ollama.com), and a corpus of mock papers under
`../extraction/docs` if you want the KB-backed style references. The app
will still run without a corpus — RC will just default to Aeon-based
passages.

```
# pull the two local models
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text

# set up the app
cd app
cp .env.example .env
# edit .env: set SESSION_SECRET, WORKER_TOKEN, ADMIN_USERNAME, ADMIN_PASSWORD
npm install
npm run init-db
npm run build-kb        # only if you have extraction/docs

# run
npm run dev             # terminal 1
npm run worker          # terminal 2 (optional but recommended)
# open http://localhost:3000
```

[USER_MANUAL.md](USER_MANUAL.md) has the long-form walkthrough including
troubleshooting and how to wipe state.

---

## Be honest about the model

**This is the part that needs reading.**

The whole pipeline is bottlenecked on the LLM, and the default config uses
a 7B model (`qwen2.5:7b-instruct`) running on local Ollama. On a typical
CPU/limited-GPU laptop this means:

- **One set takes 3–10 minutes to generate.** Without the worker keeping a
  pool warm, every *Generate* click is a multi-minute wait. With the worker
  running, you click and the set is instant — but the worker is still
  generating in the background.
- **Question quality is mid.** A 7B model will:
  - Occasionally drop part of a section (e.g. produce 5 QA questions out of
    a requested 10, because the others didn't survive the answer-verifier).
  - Sometimes produce an LR scenario without explicit constraints, making
    the questions unanswerable.
  - Get the arithmetic wrong in a DI question even when the table is right.
  - Generate plausible-looking RC questions whose "correct" answer is
    debatable.
- The codebase tries hard to compensate — KB-exemplar sanitisation, strict
  prompt schemas, JSON repair, answer re-verification, anti-plagiarism
  similarity check — but it cannot make a 7B model into a 70B model.

**If you have a paid API key, plug it in.** The provider abstraction in
`src/lib/llm.ts` already supports Groq. Set in `.env`:

```
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.1-70b-versatile   # or any current Groq model
```

Restart the app + worker. You will get:

- **~10× faster generation** (seconds per set instead of minutes).
- **Substantially better quality** — unique LR puzzles that actually solve,
  arithmetically correct DI answers, RC questions with defensible single
  best answers.

Other drop-in options: any OpenAI-compatible endpoint (OpenRouter,
together.ai, an OpenAI key, a local vLLM/llama.cpp server). Adding a
provider is one function in `llm.ts`.

---

## What this repo lacks / known limitations

- **No knowledge base in the repo.** `extraction/docs` is the templatized
  source corpus and runs to ~130 MB; it isn't included. The app will run
  without it (RC will pull only from Aeon), but VA/QA/DI/LR exemplar
  diversity will be poor. Bring your own corpus and run `npm run build-kb`,
  or improve the prompts to lean less on exemplars.
- **No proper test suite.** Smoke testing has been manual end-to-end.
- **No Postgres / cloud-DB support yet.** Data layer (`src/lib/db.ts`) is
  isolated, but moving to Postgres + pgvector for hosted deployment is
  still a TODO.
- **Worker is a single in-process loop.** No retries on persistent LLM
  failures, no metrics, no horizontal scaling. Fine for a single user;
  not fine for a public deployment with many users.
- **No rate limiting** on the public endpoints. You'd want one before
  exposing this to the internet.
- **CAT 2024+ pattern only** for the section shapes encoded in
  [config.ts](app/src/lib/config.ts).

See [CAT_Mock_Generator_Plan.md](CAT_Mock_Generator_Plan.md) for the
longer-term plan and design notes.

---

## Project layout

```
app/
  src/app/               Next.js routes (pages + /api)
  src/lib/
    config.ts            env-driven configuration
    db.ts                SQLite data access
    auth.ts              registration, login, sessions
    llm.ts               provider abstraction (Ollama / Groq)
    kb.ts                knowledge-base retrieval + similarity
    practice.ts          scoring
    generate/            prompt builders + the generation engine
  scripts/
    init-db.mjs          schema + admin seed
    build-kb.mjs         templatized docs -> kb_items + embeddings
    worker.mjs           background pool topup loop
extraction/
  pipeline/              optional scripts to build your own corpus
USER_MANUAL.md           operator walkthrough
CAT_Mock_Generator_Plan.md   design + roadmap
```

---

## Deploying to Vercel + Supabase + Groq

The `cloud-deploy` branch contains a Postgres adapter and a Vercel Cron
worker so the whole thing can run on free tiers with a public URL.

1. **Groq**: sign up at https://console.groq.com, create an API key.
2. **Supabase**: create a project (region nearest you). Open Project
   Settings → Database → Connection string → URI mode; copy the
   `postgresql://...` URL.
3. **Vercel**: import the GitHub repo. Set **Root Directory** to `app`.
4. In Vercel project settings → Environment Variables, add:
   - `DATABASE_URL` = Supabase URI
   - `LLM_PROVIDER` = `groq`
   - `GROQ_API_KEY` = `gsk_...`
   - `GROQ_MODEL` = `llama-3.1-70b-versatile`
   - `SESSION_SECRET` = 64 random hex chars
   - `WORKER_TOKEN` = 64 random hex chars (also reused as CRON_SECRET)
   - `CRON_SECRET` = same as WORKER_TOKEN
   - `ADMIN_USERNAME` = your choice
   - `ADMIN_PASSWORD` = strong password
   - `POOL_SIZE` = `3`
   - `APP_URL` = your Vercel domain (set after first deploy)
5. First deploy. Then run the schema seed from your laptop with the same
   env (`DATABASE_URL` set): `npm run init-db`.
6. Vercel Cron will start firing `/api/internal/cron-topup` every 5
   minutes and refill the pool.

Notes:
- The KB (`extraction/docs`) is not deployed — RC will fall back to Aeon
  essays / LLM-generated passages; other sections use exemplar-free prompts.
- Vercel Hobby caps function duration at 60s. A single set generation on
  Groq runs well under that; very occasionally a multi-call section (VA, QA)
  may time out. The cron will simply retry the section next tick.

## License

No license declared — treat as all-rights-reserved by the author until one
is added.
