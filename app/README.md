# CAT Mock Generator

Generates fresh CAT-style problem sets (VA, RC, DI, LR, QA) from a knowledge
base built out of past mock papers, using a local LLM.

## Prerequisites

- **Node.js 20 LTS** (recommended). Newer versions also work but 20 LTS gives
  the smoothest `better-sqlite3` install via prebuilt binaries.
- **Ollama** for the local LLM — https://ollama.com
  After installing, pull the models:
  ```
  ollama pull qwen2.5:7b-instruct
  ollama pull nomic-embed-text
  ```

## Setup

```bash
# 1. install dependencies
npm install

# 2. create your environment file
cp .env.example .env
#    then review .env (admin credentials, LLM settings, pool size)

# 3. initialise the database and seed the admin account
npm run init-db

# 4. build the knowledge base from the extracted mock documents
npm run build-kb

# 5. start the app
npm run dev
```

The app runs at http://localhost:3000.

To keep a buffer of ready-to-serve sets, run the worker in a second terminal:

```bash
npm run worker
```

## Project layout

```
src/app/        Next.js pages and API routes
src/lib/        config, database, LLM client, generators
scripts/        init-db, build-kb, worker (standalone Node scripts)
data/           the SQLite database file (created at runtime, git-ignored)
```

## Notes

- The database is SQLite (`data/cat.db`) for simple local hosting. The
  data-access layer is isolated in `src/lib/db.ts` so it can be moved to
  Postgres when deploying to a server.
- `EXTRACTION_DOCS` in `.env` points at the templatized mock documents
  produced by the ingestion step (`../extraction/docs`).
- Admin credentials are seeded from `.env`. Change the password after first
  login and never commit `.env`.
