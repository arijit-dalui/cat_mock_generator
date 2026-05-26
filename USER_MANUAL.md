# CAT Mock Generator — User Manual

A locally-running web application that generates fresh CAT-style problem sets
(VA, RC, DI, LR, QA) from a knowledge base of past mock papers, using a local
LLM. Every problem comes with a worked solution and a per-option
explanation. When you submit your answers, you are scored against the LLM's
answer key.

This manual covers everything from a fresh install to day-to-day operation
and troubleshooting.

---

## 1. What you need before you start

You install three things, once.

**Node.js 20 LTS** — https://nodejs.org. Pick the LTS download. After
installing, open a new terminal and run `node --version`; you should see
`v20.x.x`.

**Ollama** — https://ollama.com. This is the engine that runs the local LLM
on your machine. After installing, Ollama runs as a background service on
http://localhost:11434. To pull the two models the app uses, open a terminal
and run:

```
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text
```

The 7B chat model is about 4.5 GB and the embedding model is around 280 MB.
First run downloads them; later runs are instant.

A working internet connection is needed for the initial downloads
(Node, Ollama, the models, and the app's npm dependencies). After that the
app runs entirely offline.

---

## 2. First-time setup

Your project folder is `C:\cat\CAT_25\wish`. The app lives in
`C:\cat\CAT_25\wish\app`. From a terminal:

```
cd C:\cat\CAT_25\wish\app
```

### 2.1 Remove the stale install

The first sandbox install left a partial `node_modules` folder behind. Delete
it before installing fresh:

```
rmdir /s /q node_modules
```

(In PowerShell you can also use `Remove-Item -Recurse -Force node_modules`.)

### 2.2 Create your environment file

Copy the template and review the values:

```
copy .env.example .env
notepad .env
```

What to set:

- `ADMIN_USERNAME` and `ADMIN_PASSWORD` — already set to your admin
  credentials. Change the password later from the database if you want.
- `SESSION_SECRET` — replace with a long random string. Any 30+ random
  characters will do.
- `WORKER_TOKEN` — replace with another long random string. The worker
  authenticates to the app using this.
- Leave everything else at the defaults.

Save and close.

### 2.3 Install dependencies, then initialise the database and knowledge base

```
npm install
npm run init-db
npm run build-kb
```

`npm install` pulls about 300 packages — this takes a minute or two.
`init-db` creates `data\cat.db` and seeds your admin account.
`build-kb` reads `..\extraction\docs` and fills the knowledge base — expect
roughly 28,000 question exemplars and 2,000 reading-comprehension passages
spread across all five sections.

You only do this section once. After that you only run the commands in
section 3.

### 2.4 If PowerShell refuses to run npm

PowerShell on Windows blocks unsigned scripts by default. If you see
`npm.ps1 cannot be loaded because running scripts is disabled`, do one of:

- Use **Command Prompt** (`cmd.exe`) instead of PowerShell. It has no such
  restriction.
- Or use `npm.cmd` instead of `npm`: `npm.cmd install`, `npm.cmd run init-db`.
- Or, the proper fix once and for all: run
  `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
  in PowerShell, answer `Y`, close and reopen. Now `npm install` works
  normally and you never have to do this again.

---

## 3. Running the app

You need two things running at the same time: **Ollama** (already running as
a background service if you installed it) and the **app**. The **worker** is
optional but strongly recommended.

Open **two terminals** in `C:\cat\CAT_25\wish\app`.

**Terminal 1 — the app:**

```
npm run dev
```

Wait for the line `- Local: http://localhost:3000`. Leave this terminal open.

**Terminal 2 — the worker (optional):**

```
npm run worker
```

The worker keeps a pool of pre-generated sets in the database (50 per
section by default) so that when you click Generate, you get a set
instantly. Without the worker the app still works, but every Generate click
triggers a fresh LLM run that takes one to three minutes on a CPU.

Open **http://localhost:3000** in your browser.

To stop the app, press Ctrl+C in each terminal.

---

## 4. Using the app as a learner

### 4.1 Register and sign in

On the home page, click **Create an account**. Pick a unique username
(3–30 characters; letters, digits and `@ . _ -` allowed) and a password
(at least 6 characters). You are taken straight to the dashboard.

To return later, the **Log in** button on the home page accepts the same
username and password.

### 4.2 The dashboard

Five tabs across the top: **VA**, **RC**, **DI**, **LR**, **QA**. Click a
tab to switch sections.

Each tab has two parts:

- A **Generate a new set** button. Clicking it gives you a fresh set,
  shaped to your spec: VA → 10 questions mixed across para-completion,
  para-jumble, odd-one-out and summary; RC → 2 passages × 4 questions
  (sometimes from a fresh Aeon essay, sometimes from a mock-style passage);
  DI → 2 sets; LR → 2 sets; QA → 10 questions mixed across geometry,
  algebra, arithmetic, number systems and modern math.
- A list of your **previously generated** sets in that section, newest
  first. Each shows the date and either your score (if you submitted) or
  "Not attempted". Click any row to open it.

### 4.3 Solving a set

The solving screen shows every question with its 4 options. For RC, DI and
LR you'll see the passage / data / scenario above its block of 4 questions.
Pick an option per question. If you skip a question, that's fine — it
counts as wrong.

When you're done, click **Submit answers**. The app scores you against the
LLM's answer key and switches to review mode for that tab.

### 4.4 Review mode

After submission, the screen shows:

- Your total score at the top (e.g. `7 / 10`).
- Each question's correct option highlighted in green; if you picked a wrong
  option, your pick is shown in red.
- A short explanation under **every** option saying why it is or isn't
  correct.
- The full worked solution at the bottom of each question.

Already-submitted sets reopen in review mode whenever you click them from
the dashboard list.

---

## 5. Using the app as admin

Sign out (button top-right of the dashboard), then log in as your admin
account: the username and password you set as `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env`. You land on
the admin dashboard at `/admin`.

The admin view shows:

- **Registered users** — total user accounts.
- **Registrations in last 30 days** — sum of recent signups.
- **Distinct visitors today** — unique logins logged today.
- **Daily active visitors (last 14 days)** — a bar chart.
- **By section table** — sets generated, sets solved, average score (as
  a percentage), current pool depth, and knowledge-base size, broken out
  for VA / RC / DI / LR / QA.

Log out and you're back to a normal browser session.

---

## 6. Day-to-day operations

### 6.1 Keep the worker running

If you'd like instant Generate clicks, leave `npm run worker` running.
On Windows you can put both terminals in tabs of Windows Terminal so they
sit in the background. The worker prints one line per generated set
(`[worker] QA: pool 12/50, generating... +1 (set 47, 82s)`).

When the pool is full it idles ("pool full — idle") and sleeps 60 seconds
between checks.

### 6.2 Adjust how many sets are pre-generated

Open `.env` and change `POOL_SIZE`. Lower it (say, 5) while you're
testing — fewer ready sets, but the worker stops sooner. Raise it later for
real use. Save the file and restart the worker terminal.

### 6.3 Rebuild the knowledge base

If you re-run the extraction step against new mock papers in
`C:\cat\CAT_25\wish\extraction\docs`, rebuild the knowledge base from
the app folder:

```
npm run build-kb
```

This wipes `kb_items` and re-fills it from the current docs folder. Safe to
re-run any time.

### 6.4 Clear everything and start over

Stop the app and worker (Ctrl+C in both terminals). In the app folder:

```
del data\cat.db
npm run init-db
npm run build-kb
```

That wipes users, sessions, generated sets and attempts, then re-seeds the
admin and rebuilds the knowledge base.

### 6.5 Change the admin password

Stop the app. Edit `.env`, set `ADMIN_PASSWORD` to the new value. Delete the
admin row from the database so it gets re-seeded:

```
node -e "const D=require('better-sqlite3'); new D('./data/cat.db').prepare(\"DELETE FROM users WHERE role='admin'\").run()"
npm run init-db
```

---

## 7. Troubleshooting

**Generate click takes a long time.**  Normal for a CPU LLM — a 7B model on
CPU takes 1–3 minutes per set. Run the worker (`npm run worker`) and the
pool will absorb the wait. To shrink first-fill time, lower `POOL_SIZE` to
5 while testing.

**Error: "Could not generate a set. Is the LLM (Ollama) running?"**  Open
http://localhost:11434/ in a browser — if it shows nothing or refuses to
connect, Ollama isn't running. On Windows, search for "Ollama" in the
start menu and launch it; or in a terminal run `ollama serve`.

**Error: model not found.**  You haven't pulled the model yet. Run
`ollama pull qwen2.5:7b-instruct` (and `ollama pull nomic-embed-text`).

**Port 3000 already in use.**  Something else is running on 3000 (another
Next app, perhaps). Set a different port: `npx next dev -p 3001`. Then
update `APP_URL` in `.env` to match before starting the worker.

**The worker logs "Unauthorized".**  Your `WORKER_TOKEN` in `.env` doesn't
match what the running app loaded. Restart the app terminal so it picks up
the current `.env`, then restart the worker.

**npm install hangs on `better-sqlite3`.**  The package compiles a native
binding on Windows. If you don't have build tools, follow the prompt to
install windows-build-tools, or `npm install --global windows-build-tools`,
then re-run `npm install`. Node 20 LTS usually has prebuilt binaries
available so this rarely happens.

**A generated question looks wrong.**  The 7B model on CPU is imperfect.
QA passes through an answer-verification step that drops questions whose
answers don't survive an independent re-solve, but the verifier is itself
the LLM. If you spot a bad question, regenerate the set; the worker will
produce a different one. Long-term improvements (template+solver
verification, better classification) are listed in
`CAT_Mock_Generator_Plan.md` in this folder.

---

## 8. Going to a free hosted server later

The local-first build is intentionally portable. When you want to share the
app:

- **App (UI + API):** deploy the `app` folder to **Vercel** free tier.
  Connect a Git repo, set the same environment variables in Vercel's
  project settings.
- **Database:** move from SQLite to **Supabase** free tier (Postgres with
  pgvector included). The data-access layer is isolated in `src/lib/db.ts`
  so this is the only file that needs editing.
- **LLM:** the easiest free path is **Groq's API** — set `LLM_PROVIDER=groq`
  and `GROQ_API_KEY=...` in production environment variables. No code
  changes; the LLM layer already supports Groq.
- **Worker:** run it on a free always-on host (Oracle Cloud Always Free ARM
  VM, or an Inngest/QStash free queue triggering the topup endpoint on a
  schedule).

The architecture document at
`C:\cat\CAT_25\wish\CAT_Mock_Generator_Plan.md` covers the move in detail.

---

## 9. Where things live

```
C:\cat\CAT_25\wish\
  app\                       The application
    src\app\                 pages and API routes
    src\lib\                 config, db, auth, llm, kb, generation engine
    scripts\                 init-db, build-kb, worker
    data\cat.db              the SQLite database (created at runtime)
    .env                     your settings (do not commit, do not share)
  extraction\
    docs\                    550 templatized mock documents (Step 1 output)
    ingestion_report.md      what was readable / what needed OCR
    pipeline\                ingestion scripts (extract, ocr, templatize)
  CAT_Mock_Generator_Plan.md design and future-work plan
  ADMIN_CREDENTIALS.txt      your admin username + generated password
  USER_MANUAL.md             this file
```

Files you can delete to reclaim space:

- `extraction\extracted\raw\` — intermediate raw text (the templatized
  docs in `extraction\docs\` are the real output).
- `app\node_modules\` — gets recreated by `npm install` any time.

Files you should keep private:

- `.env` (contains your admin password and worker token).
- `ADMIN_CREDENTIALS.txt`.
- `data\cat.db` (contains user accounts).

---

## 10. Quick reference

```
# one-time setup
cd C:\cat\CAT_25\wish\app
rmdir /s /q node_modules
copy .env.example .env
notepad .env                   ← set SESSION_SECRET and WORKER_TOKEN
npm install
npm run init-db
npm run build-kb

# every time you want to use the app
npm run dev                    ← terminal 1
npm run worker                 ← terminal 2 (optional but recommended)
# open http://localhost:3000

# admin login: use ADMIN_USERNAME / ADMIN_PASSWORD from .env
```
