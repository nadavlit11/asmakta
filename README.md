# Asmakta — a document-Q&A assistant with a published eval report

> **אסמכתא** (Hebrew/Talmudic: *a supporting citation/source*). The name is the
> promise: **every answer is backed by a cited source, or there is no answer.**

Asmakta is a small but production-shaped RAG (retrieval-augmented generation)
assistant over a **bilingual Hebrew + English** corpus. You ask a question; it
retrieves the most relevant source chunks from Postgres + pgvector and asks Claude
to answer **using only those chunks, with inline citations**. A hard guardrail:
**no source above the similarity threshold → no answer** ("I don't have this in
the corpus"), and **never an invented citation**.

The differentiator no competitor shows is a **public eval report**: a fixture set
of Q&A pairs (including trap questions that are *not* answerable from the corpus),
scored automatically for **answer correctness**, **citation validity**, and
**refusal correctness**, with the current pass-rate, a per-category / per-language
breakdown, and history over commits.

Full design rationale (models, pricing, schema, cost model, risks) lives in
[`docs/plan.md`](docs/plan.md).

## Architecture

```
upload (PDF/DOCX/HTML/MD)
   └─ parse → chunk (heading-aware, sentence-safe, overlap)
        └─ embed (Voyage voyage-4-lite, 1024-dim)
             └─ store  ──►  Postgres + pgvector (HNSW, cosine)

ask ─ embed query ─► cosine search (threshold, version-filtered) ─► [rerank?]
       └─ answer (Claude, structured output) ─ guardrail ─► answer + citations
                                                              │
eval ─ fixtures ─► retrieve+answer ─► deterministic rubric ─┤─► judge (Claude Opus)
                                        (refusal, citation)  └─► pass-rate + report
```

- **Generation:** Claude `claude-sonnet-5` (answering) / `claude-opus-4-8` (eval judge).
- **Embeddings:** Voyage `voyage-4-lite` @ 1024-dim (Anthropic has no embeddings API).
- **Store:** Postgres 16/17 + pgvector 0.8 (HNSW, `vector_cosine_ops`).
- All model ids + prices live in one module: [`src/config/models.ts`](src/config/models.ts).

## Quick start

```bash
# 1. Install
npm install

# 2. Database (choose one)
docker compose up -d                       # local Postgres + pgvector, or
#   use a Neon connection string in .env

# 3. Configure
cp .env.example .env                       # then fill in the keys below

# 4. Schema + demo data
npm run migrate                            # create tables + HNSW index
npm run seed:fixtures                      # 35 eval fixtures (no API key needed)
npm run seed:corpus                        # embed the demo corpus (needs VOYAGE key)

# 5. Run
npm run dev                                # API at http://localhost:$PORT
npm run eval                               # run the eval suite (gate: exits non-zero < target)
```

### Environment

Copy `.env.example` → `.env`. See [`docs/plan.md`](docs/plan.md) §9 for where each
value comes from and expected costs (target: **~$5/mo**).

| Var | Needed for | Notes |
|---|---|---|
| `DATABASE_URL` | everything | Neon (prod) or local docker-compose. |
| `ANTHROPIC_API_KEY` | answering + eval judge | console.anthropic.com; ~$2–5/mo. |
| `VOYAGE_API_KEY` | embeddings | voyageai.com; 200M free tokens one-time. |
| `ADMIN_TOKEN` | upload / reingest / fixtures routes | any random string. |

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Fastify API with watch. |
| `npm run migrate` | Apply DB migrations. |
| `npm run seed:corpus [-- --dry]` | Embed the demo corpus (`--dry` = parse+chunk only, no key). |
| `npm run seed:fixtures [-- --dry]` | Load eval fixtures (no key needed). |
| `npm run ingest -- <file> [--dry]` | Ingest one file. |
| `npm run eval [-- --rerank]` | Run the eval suite; **exits non-zero below the target pass-rate**. |
| `npm run scratch:embed \| scratch:retrieve \| scratch:ask` | Manual probes (need keys). |
| `npm run typecheck` / `npm test` | Type-check / unit tests. |

## API (selected)

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | — | Liveness + DB ping. |
| `POST /api/chat` | — | `{question}` → answer + citations (or refusal). |
| `GET /api/corpus/:slug/status` | — | Docs, chunk counts, failed-parse queue. |
| `POST /api/documents?corpus=…&lang=…` | admin | Upload (multipart) → ingest. |
| `GET /api/documents?corpus=…` | — | List documents + status. |
| `POST /api/eval/run` | admin | Kick off an eval run (async). |
| `GET /api/eval/latest` | — | Latest run summary (feeds the public report page). |
| `GET /api/eval/runs` / `GET /api/eval/runs/:id` | — | Run history / per-fixture detail. |

## The eval

`npm run eval` grades every fixture:

- **refusal correctness** — traps must be refused; answerable must be answered *(deterministic)*.
- **citation validity** — no invented citations; answered fixtures must cite an expected source *(deterministic)*.
- **answer correctness** — an LLM judge (`claude-opus-4-8`) grades the answer against a gold answer + explicit criteria *(only for answerable+answered fixtures)*.

`verdict = answer_correct AND citation_valid AND refusal_correct`. Results persist
to `eval_runs` / `eval_results`; the report shows the pass-rate vs the target,
per-category and per-language bars, history over commits, and failing fixtures
with the judge's rationale.

## Project layout

```
src/config/     models.ts (ids+pricing, single source), env.ts
src/db/         client, migrate, queries, migrations/
src/ingest/     parse/{pdf,docx,html,md}, chunk, embed, orchestrator
src/retrieve/   pgvector cosine search + rerank
src/answer/     prompt + guardrail
src/eval/       rubric (deterministic), judge, run, cli, fixtures/
src/api/        server, auth, routes/
corpus/         demo labor-rights documents (illustrative — see corpus/README.md)
web/            Vite + React bilingual UI (chat, admin, eval report)
```

## Status

Backend + eval harness are implemented and covered by unit tests + live DB checks.
The Claude/Voyage-dependent paths (answering, judging, embedding, and therefore a
full eval run) require the two API keys above. See the branch commit messages for
per-milestone done-probes.

> ⚠️ The demo corpus documents are **simplified, illustrative** summaries — not
> legal advice or authoritative texts. The eval measures faithfulness *to the
> corpus*; replace with authoritative sources before any real use.
