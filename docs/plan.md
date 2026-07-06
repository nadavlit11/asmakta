# Implementation Plan — Asmakta (RAG assistant with visible evals)

> **Audience:** an Opus 4.8 implementation session with **zero memory of the planning session**. Everything you need is in this repo. Read `BRIEF.md` for the "why", this file for the "how". Follow the project rules in `CLAUDE.md` (worktree per task, `/kit:code-review` before every commit, re-run the eval suite when prompts/retrieval change and report the pass-rate in the commit body).
>
> **Product name:** **Asmakta** (אסמכתא — Hebrew/Talmudic for "a supporting citation/source"). The name is the promise: every answer is backed by a cited source, or there is no answer.
>
> **Decisions already made by Nadav (do not re-litigate):**
> - Demo corpus subject: **Israeli labor / employment rights** (bilingual He/En).
> - Eval "green" bar: **90% overall pass-rate**.
> - Monthly cost ceiling: **~$5/mo** (infra free-tier; this covers Anthropic + Voyage API for the live demo and periodic eval runs).

---

## 0. What we are building (one paragraph)

A small but production-shaped document-Q&A assistant over a bilingual (Hebrew + English) corpus of Israeli labor-rights material. Users ask a question; the system retrieves the most relevant source chunks from a Postgres+pgvector index and asks Claude to answer **using only those chunks, with inline citations**. A hard guardrail: **no source above the similarity threshold → no answer** ("I don't have this in the corpus"), and **never an invented citation**. The differentiator no competitor shows is a **public eval report page**: a fixture set of Q&A pairs (including trap questions that are *not* answerable from the corpus), scored automatically for answer correctness, citation validity, and refusal correctness, with the current pass-rate, a per-category breakdown, and history over commits.

---

## 1. Stack + model decisions (with rationale and verified pricing)

### 1.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language / runtime | **Node 20+ / TypeScript (strict)** | Nadav's background; one language across API, pipeline, eval, and web. |
| API framework | **Fastify** | Nadav's production background is Fastify + Postgres. Fast, typed, schema-validated routes. |
| DB | **Postgres 16 + pgvector 0.8.x** | Nadav's background; pgvector is the vector store. |
| Managed DB host | **Neon (free tier)** | pgvector is on **every Neon plan with no add-on**; free tier scale-to-zero **auto-resumes on the next connection** (cold-start only, no manual un-pause). See §7 for the Supabase-vs-Neon tradeoff. |
| Embeddings | **Voyage AI `voyage-4-lite`, 1024-dim, float** | Anthropic has **no** embeddings API and officially recommends Voyage. `voyage-4-lite` is $0.02/1M + 200M free tokens (one-time), multilingual, and 1024-dim indexes directly in pgvector. See §1.3. |
| Reranker (optional, phase 2) | **Voyage `rerank-2.5`** | Multilingual cross-encoder; a low-risk quality lever for Hebrew and a great "with/without rerank" eval story. $0.05/1M + 200M free. |
| Answer generation | **Claude `claude-sonnet-5`** (configurable) | Near-Opus quality on grounded Q&A at ~½ the cost; keeps live-demo traffic under the $5/mo ceiling. One-line switch to `claude-opus-4-8` in config. |
| Eval judge | **Claude `claude-opus-4-8`** | The strongest model grades the (cheaper) answerer against a gold answer + explicit rubric — a defensible, honest design that also reduces self-preference bias (judge is a different, stronger tier than the answerer). |
| Web UI | **Vite + React + TypeScript**, bilingual He/En (RTL-aware) | Nadav is newer to frontend — keep it minimal and componentised (see §5). |
| Validation | **zod** | Env, route bodies, and structured-output schemas. |
| DB access | **`pg` (node-postgres) + hand-written SQL** | No heavy ORM; pgvector needs raw SQL for the `<=>` operator anyway. |

> **Frontend note for Nadav (backend dev):** Vite is the dev server + bundler; `.tsx` files are React components (HTML-in-JS with typed props). "RTL-aware" means the UI must flip layout direction for Hebrew (`dir="rtl"`) — CSS logical properties (`margin-inline-start`, not `margin-left`) handle most of it. Keep the web app deliberately small; the backend + eval harness are the portfolio substance.

### 1.2 Model IDs and pricing (VERIFIED against live docs, 2026-07-06)

Keep **all** model IDs and per-token prices in **one module** — `src/config/models.ts` — never scattered (project rule).

| Purpose | Model ID | Input $/1M | Output $/1M | Context | Notes |
|---|---|---|---|---|---|
| Answer generation (default) | `claude-sonnet-5` | $3.00 (**$2.00 intro thru 2026-08-31**) | $15.00 (**$10.00 intro**) | 1M | Adaptive thinking on by default; supports structured outputs. |
| Answer generation (quality alt) | `claude-opus-4-8` | $5.00 | $25.00 | 1M | One-line config switch if Sonnet quality is insufficient on Hebrew. |
| Eval judge | `claude-opus-4-8` | $5.00 | $25.00 | 1M | Strongest widely-released Claude at plan time. |
| Cheap utility (optional) | `claude-haiku-4-5` | $1.00 | $5.00 | 200K | For any classification/labeling side-tasks; not on the answer path by default. |
| Embeddings | `voyage-4-lite` | $0.02 | — | 32K | 1024-dim default; 200M free tokens (one-time grant). |
| Rerank (phase 2) | `rerank-2.5` | $0.05 | — | 32K | 200M free tokens; multilingual. |

**Anthropic API facts the implementer must honor** (from the `claude-api` reference):
- `claude-sonnet-5` / `claude-opus-4-8`: **adaptive thinking only** — `thinking: {type: "enabled", budget_tokens: N}` returns 400. Use `thinking: {type: "adaptive"}` or omit. **No** `temperature`/`top_p`/`top_k` (400). **No** assistant-turn prefills (400).
- Use **structured outputs** for both the answer and the judge: `output_config: {format: {type: "json_schema", schema: …}}` (or `client.messages.parse()` with a zod schema). Supported on Sonnet 5, Opus 4.8, Haiku 4.5.
- Use the official SDK `@anthropic-ai/sdk`; default `max_tokens` ~1024–2048 for answers, ~512 for the judge.
- **Never** count tokens with `tiktoken` — use the `count_tokens` endpoint (`client.messages.countTokens`) for cost estimation.

**Voyage API facts** (from live docs):
- Endpoint `POST https://api.voyageai.com/v1/embeddings`; official npm SDK **`voyageai` ≥ 0.4.0** (pin the exact version — npm index showed 0.2.1 but the repo's latest is 0.4.0).
- **Always set `input_type`**: `"document"` when embedding corpus chunks, `"query"` when embedding a user query. Voyage prepends distinct instructions and this measurably improves retrieval.
- Embeddings are L2-normalized (cosine == dot product). Batch limits: ≤1000 texts/request; `voyage-4-lite` allows ~1M tokens/request.
- SDK params are camelCase in TS: `inputType`, `outputDimension`, `outputDtype`. Verify the exact `rerank()` field names against the installed types before using it.

### 1.3 Why `voyage-4-lite` @ 1024-dim (and not 2048)

- **Cost:** $0.02/1M + 200M free (one-time). The whole demo corpus and all eval queries will almost certainly cost **$0** to embed.
- **Indexability:** pgvector's `vector` type + HNSW/IVFFlat index supports a **max of 2000 dimensions**. 1024 indexes directly. **2048 would exceed the HNSW ceiling** and force the `halfvec` type — avoid it for a simple demo.
- **Upgrade path if Hebrew retrieval underperforms in evals:** switch the config to `voyage-4` ($0.06/1M) or `voyage-4-large` ($0.12/1M) — a one-line model-ID change — and/or turn on `rerank-2.5`. Re-embed the corpus when you change the embedder.
- **Flagged unknown:** no Voyage source names or benchmarks **Hebrew** specifically (the line is marketed as generically multilingual over 26 languages). **The eval suite is what actually proves Hebrew quality** — this is the whole point of the project.

### 1.4 Cost estimate (real numbers, to hold the ~$5/mo ceiling)

Assumptions: retrieval returns 5 chunks × ~400 tokens = ~2,000 ctx tokens; answer system prompt ~700 tokens; question ~60 tokens → **~2,760 input / ~300 output** per answer. Query embedding ~60 tokens (free tier). Judge input ~2,200 (question + gold + candidate + cited chunks + rubric) / ~120 output.

| Item | Model | Unit cost | Notes |
|---|---|---|---|
| One demo Q&A | `claude-sonnet-5` (intro) | **~$0.009** | ~$0.013 at standard Sonnet price; **~$0.022** if answering with Opus. |
| One demo Q&A embedding | `voyage-4-lite` | **$0** | Within 200M free tokens. |
| One eval run — answering (35 fixtures) | `claude-sonnet-5` | **~$0.35** | 35 × ~$0.010. |
| One eval run — judge (~24 answerable) | `claude-opus-4-8` | **~$0.45** | ~24 × ~$0.018 (judge only runs on answered, answerable fixtures). |
| One eval run total | — | **~$0.8–1.0** | Embeddings free. |

**Monthly projection (default config):** ~200 demo queries × ~$0.010 = **~$2.0** + weekly eval (4 × ~$0.9) = **~$3.6** → **~$5.6/mo**. To stay under $5: run eval **on-commit + biweekly** (not weekly) *or* trim to ~30 fixtures *or* judge with `claude-sonnet-5` too (drops the judge line to ~$0.15/run). Prompt caching is **marginal** here (the answer's variable retrieved chunks can't cache; the stable prefix is below Opus's 4,096-token cache minimum) — the real levers are **model choice, bounded fixture count, and eval frequency**. Implement a hard per-run cost cap and a monthly counter (`src/lib/cost.ts`) and surface it on the eval report.

---

## 2. Database schema (Postgres + pgvector) — full DDL, no TBDs

Put this in `src/db/schema.sql`; run via a tiny migration runner (`src/db/migrate.ts`). All facts (types, 2000-dim HNSW limit, operator↔ops-class pairing, defaults) are from the official pgvector README.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- A corpus is a named collection with an ACTIVE version pointer (enables
-- re-ingestion/versioning + instant rollback).
CREATE TABLE corpora (
    id             bigserial PRIMARY KEY,
    slug           text NOT NULL UNIQUE,          -- e.g. 'labor-rights'
    name           text NOT NULL,
    active_version int  NOT NULL DEFAULT 1,       -- retrieval reads this version
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
    id          bigserial PRIMARY KEY,
    corpus_id   bigint NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
    version     int    NOT NULL,                  -- ingestion version this doc belongs to
    filename    text   NOT NULL,
    mime_type   text   NOT NULL,                  -- application/pdf | .../vnd.openxml… | text/html | text/markdown
    source_lang text   NOT NULL,                  -- 'he' | 'en' | 'mixed'
    sha256      text   NOT NULL,                  -- content hash for dedup
    status      text   NOT NULL DEFAULT 'pending',-- pending|parsing|chunking|embedding|indexed|failed
    error       text,                             -- failure reason (populates the failed-parse queue)
    page_count  int,
    char_count  int,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    indexed_at  timestamptz,
    UNIQUE (corpus_id, version, sha256)           -- idempotent re-ingest
);
CREATE INDEX documents_status_idx ON documents (status);
CREATE INDEX documents_corpus_version_idx ON documents (corpus_id, version);

CREATE TABLE chunks (
    id             bigserial PRIMARY KEY,
    document_id    bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    corpus_id      bigint NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
    corpus_version int    NOT NULL,               -- denormalized for fast version-filtered retrieval
    chunk_index    int    NOT NULL,               -- order within the document
    content        text   NOT NULL,
    token_count    int    NOT NULL,
    page_start     int,
    page_end       int,
    heading        text,                          -- nearest heading, if the chunker tracked one
    lang           text   NOT NULL,               -- 'he' | 'en'
    embedding      vector(1024) NOT NULL,         -- voyage-4-lite, 1024-dim
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- HNSW index for cosine distance on NORMALIZED embeddings.
--   vector_cosine_ops  <->  <=>  operator (cosine distance). Pairing is load-bearing:
--   an index built with vector_cosine_ops only accelerates the <=> operator.
CREATE INDEX chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);          -- pgvector defaults; fine at this scale

CREATE INDEX chunks_document_idx ON chunks (document_id);
CREATE INDEX chunks_corpus_version_idx ON chunks (corpus_id, corpus_version);

-- EVAL FIXTURES — the graded Q&A set (includes traps that are NOT answerable).
CREATE TABLE eval_fixtures (
    id                bigserial PRIMARY KEY,
    corpus_id         bigint NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
    question          text   NOT NULL,
    lang              text   NOT NULL,            -- 'he' | 'en'
    category          text   NOT NULL,            -- 'answerable' | 'trap' | 'multi_hop'
    is_answerable     boolean NOT NULL,           -- traps => false
    gold_answer       text,                       -- NULL for traps
    expected_doc_ids  bigint[],                   -- acceptable source documents (nullable)
    expected_chunk_ids bigint[],                  -- stricter: acceptable source chunks (nullable)
    notes             text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- EVAL RUNS — one row per `npm run eval` / API-triggered run.
CREATE TABLE eval_runs (
    id              bigserial PRIMARY KEY,
    corpus_id       bigint NOT NULL REFERENCES corpora(id),
    corpus_version  int    NOT NULL,
    git_sha         text,                         -- commit under test (history axis)
    answering_model text   NOT NULL,
    judge_model     text   NOT NULL,
    embedding_model text   NOT NULL,
    config          jsonb  NOT NULL,              -- { topK, minSimilarity, rerank, rerankTopN }
    total           int    NOT NULL DEFAULT 0,
    passed          int    NOT NULL DEFAULT 0,
    failed          int    NOT NULL DEFAULT 0,
    pass_rate       numeric,                      -- passed/total (0..1)
    by_category     jsonb,                        -- { answerable:{passed,total}, trap:{…}, he:{…}, en:{…}, … }
    cost_usd        numeric NOT NULL DEFAULT 0,
    status          text   NOT NULL DEFAULT 'running', -- running|completed|failed
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);
CREATE INDEX eval_runs_started_idx ON eval_runs (started_at DESC);

-- EVAL RESULTS — one row per fixture per run.
CREATE TABLE eval_results (
    id                 bigserial PRIMARY KEY,
    run_id             bigint NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    fixture_id         bigint NOT NULL REFERENCES eval_fixtures(id),
    refused            boolean NOT NULL,
    answer             text,
    citations          jsonb,                     -- [{ chunkId, quote? }]
    retrieved_chunk_ids bigint[],
    answer_correct     boolean NOT NULL,
    citation_valid     boolean NOT NULL,
    refusal_correct    boolean NOT NULL,
    verdict            text    NOT NULL,          -- 'pass' | 'fail'
    judge_rationale    text,
    latency_ms         int,
    cost_usd           numeric,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eval_results_run_idx ON eval_results (run_id);
```

**Retrieval query pattern** (cosine similarity = `1 - distance`; keep `ORDER BY` on the bare `<=>` operator so the HNSW index drives the scan):

```sql
-- Params: $1 = query embedding (vector), $2 = corpus_id, $3 = active version,
--         $4 = min similarity (e.g. 0.55), $5 = top_k
-- Optionally, per session, raise recall:  SET hnsw.ef_search = 100;
SELECT c.id, c.document_id, c.content, c.page_start, c.heading, c.lang,
       1 - (c.embedding <=> $1) AS similarity
FROM   chunks c
WHERE  c.corpus_id = $2
  AND  c.corpus_version = $3
  AND  1 - (c.embedding <=> $1) > $4
ORDER  BY c.embedding <=> $1
LIMIT  $5;
```

**Notes for the implementer:**
- With a version-filtered `WHERE`, plain B-tree indexes on `(corpus_id, corpus_version)` let Postgres pre-filter. If a filtered query returns fewer than `LIMIT` rows because filtering happens after the approximate graph scan, enable **iterative scans** (pgvector 0.8+): `SET hnsw.iterative_scan = strict_order; SET hnsw.max_scan_tuples = 20000;`.
- Only **one active version** is queried at a time, so the corpus stays small and HNSW build is trivial (seconds).
- **Do not** switch to IVFFlat: at hundreds–tens-of-thousands of rows with frequent re-ingest, HNSW is the correct default (IVFFlat centroids are degenerate at small scale and drift on insert).

---

## 3. Ingestion pipeline — TypeScript interfaces (stages) 

`src/ingest/types.ts`:

```ts
export type Lang = 'he' | 'en' | 'mixed';
export type DocStatus = 'pending' | 'parsing' | 'chunking' | 'embedding' | 'indexed' | 'failed';

export interface RawDocument {
  corpusId: number;
  version: number;
  filename: string;
  mimeType: string;            // application/pdf | docx | text/html | text/markdown
  bytes: Buffer;
  declaredLang?: Lang;         // optional hint from the admin upload
}

export interface ParsedPage { pageNumber: number; text: string; }

export interface ParsedDocument {
  text: string;                // full plain text (concatenated)
  pages?: ParsedPage[];        // present for PDFs; enables page-level citations
  detectedLang: Lang;
  charCount: number;
}

export interface Chunk {
  documentId: number;
  corpusId: number;
  corpusVersion: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart?: number;
  pageEnd?: number;
  heading?: string;
  lang: 'he' | 'en';
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];         // length 1024
}

// Stage signatures (each stage is pure + testable):
export type Parser  = (doc: RawDocument) => Promise<ParsedDocument>;
export type Chunker = (parsed: ParsedDocument, cfg: ChunkStrategy, ctx: { documentId: number; corpusId: number; corpusVersion: number }) => Chunk[];
export type Embedder = (chunks: Chunk[]) => Promise<EmbeddedChunk[]>;   // Voyage batch, input_type='document'
export type Indexer  = (chunks: EmbeddedChunk[]) => Promise<void>;      // INSERT into chunks

export interface ChunkStrategy {
  targetTokens: number;        // default 350
  overlapTokens: number;       // default 60
  splitOn: 'heading' | 'paragraph' | 'recursive'; // default 'recursive' (heading > paragraph > sentence)
  respectSentences: boolean;   // default true — never split mid-sentence
}
```

**Parsers** (`src/ingest/parse/*`), one per MIME type, dispatched by `parse/index.ts`:
- `pdf.ts` — extract text + per-page text. **Hebrew PDF extraction is the #1 technical risk** (RTL, ligatures, embedded fonts). Try a modern extractor (e.g. `unpdf`/`pdfjs`); if a Hebrew page comes back garbled or empty, mark the doc `failed` with a clear error so it lands in the failed-parse queue rather than silently indexing garbage. Prefer HTML/MD sources for Hebrew where available. (OCR fallback is a later phase — see §8.)
- `docx.ts` — `mammoth` (docx → text/HTML).
- `html.ts` — strip boilerplate, keep headings (`cheerio` or `@mozilla/readability`).
- `md.ts` — parse to text, keep heading structure for `splitOn: 'heading'`.

**Chunker** (`src/ingest/chunk.ts`): recursive splitter honoring `ChunkStrategy`; token counts via a tokenizer helper. Keep chunks ~250–400 tokens with ~60-token overlap; attach nearest `heading` and `pageStart/pageEnd`. Detect per-chunk `lang` (simple Hebrew-codepoint ratio check).

**Embedder** (`src/ingest/embed.ts`): wraps the `voyageai` SDK; batches ≤1000 chunks/request; `inputType: 'document'`; returns 1024-dim vectors. Retries with backoff (SDK has this).

**Orchestrator** (`src/ingest/index.ts`): `ingestDocument(raw)` runs parse → chunk → embed → store inside a transaction, advancing `documents.status` at each stage and writing `error` on failure. `reingestCorpus(corpusSlug)` bumps a new `version`, re-ingests all source files under that version, then flips `corpora.active_version` (atomic switch + instant rollback).

---

## 4. Retrieval, answering & the guardrail

### 4.1 Retrieval (`src/retrieve/retrieve.ts`)

```ts
export interface RetrievalConfig {
  corpusId: number;
  corpusVersion: number;       // resolve from corpora.active_version if omitted
  topK: number;                // default 5
  minSimilarity: number;       // default 0.55 (TUNE against eval; cosine similarity 0..1)
  rerank: boolean;             // default false (phase 2)
  rerankTopN?: number;         // if rerank: pull this many by vector, rerank down to topK (e.g. 30 -> 5)
}

export interface RetrievedChunk {
  chunkId: number; documentId: number; filename: string;
  content: string; similarity: number; pageStart?: number; heading?: string; lang: 'he'|'en';
}

export function retrieve(query: string, cfg: RetrievalConfig): Promise<RetrievedChunk[]>;
```

Flow: embed the query with `inputType: 'query'` → run the §2 SQL (pull `rerankTopN` if reranking, else `topK`) → if `cfg.rerank`, call `rerank-2.5` and keep the top `topK`. Return chunks sorted by final score.

### 4.2 Answering + hard guardrail (`src/answer/answer.ts`)

```ts
export interface Citation { chunkId: number; quote?: string; }
export interface Answer {
  refused: boolean;
  text: string;                // the refusal string when refused
  citations: Citation[];       // [] when refused
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  model: string;
}

export function answer(question: string, retrieved: RetrievedChunk[], cfg: AnswerConfig): Promise<Answer>;
```

**Guardrail logic (deterministic + model-enforced, belt and suspenders):**
1. **No source → no answer (deterministic short-circuit).** If `retrieved` is empty *or* `max(similarity) < cfg.minSimilarity`, return a **canned refusal** in the question's language — **no LLM call** (saves cost, guarantees the guardrail).
2. Otherwise call Claude with **structured output** so citations are machine-readable:
   ```jsonc
   // output_config.format schema
   { "type":"object", "additionalProperties":false,
     "required":["refused","answer","citations"],
     "properties":{
       "refused":{"type":"boolean"},
       "answer":{"type":"string"},
       "citations":{"type":"array","items":{"type":"integer"}}  // chunk ids
     } }
   ```
3. **Post-validation (never an invented citation):** drop any returned citation id not present in `retrieved`. If, after dropping, a *non-refused* answer has **zero valid citations**, force it to a refusal (no source, no answer). This is the mechanical enforcement of the core promise — do not rely on the model alone.

**Answer system prompt** (`src/answer/prompt.ts`), the guardrail spelled out:
- You answer questions about **Israeli labor / employment rights** using **only** the provided `<sources>`.
- Every factual claim must be supported by a source; put the supporting chunk id(s) in `citations`.
- If the sources do **not** contain the answer, set `refused: true`, put the localized refusal string in `answer`, and return an empty `citations` array. **Do not** use outside knowledge. **Never** cite an id that is not in the provided sources.
- Answer in the **same language as the question** (Hebrew question → Hebrew answer).
- Sources are passed as `[#<chunkId>] <content>` blocks.
- Refusal strings: EN — "I don't have this in the corpus."; HE — "המידע הזה לא נמצא במאגר."

### 4.3 Rerank (`src/retrieve/rerank.ts`, phase 2)

Wrap `rerank-2.5`; input the query + candidate chunk contents, keep top `topK`. Gate behind `RetrievalConfig.rerank`. Every time you flip this on/off, re-run `npm run eval` and record both pass-rates (this is the headline "with/without rerank" story on the eval page).

---

## 5. Eval harness (first-class feature)

The eval is the portfolio centerpiece. **It must land before any prompt/retrieval tuning** and, per project rule, **every change to prompts, chunking, retrieval, or rerank re-runs `npm run eval` and reports the pass-rate in the commit body.**

### 5.1 Scoring rubric — exact per-question verdict logic (`src/eval/rubric.ts`)

For each fixture, after running retrieval + `answer()`:

**Three sub-checks (refusal & citation are DETERMINISTIC code — no LLM; only answer-correctness uses the judge):**

```
refusal_correct:
    trap (is_answerable == false):      refused == true
    answerable (is_answerable == true): refused == false

citation_valid:
    refused:      citations.length == 0
    answered:     every citation.chunkId ∈ retrieved_chunk_ids            (no invented cites)
              AND (expected_chunk_ids/​expected_doc_ids defined ?
                     at least one cited chunk ∈ expected set              (cited the RIGHT source)
                   : true)

answer_correct:
    trap:                       == refusal_correct         (correct behavior IS refusal; no content to grade)
    answerable & refused:       false                      (missed a real answer)
    answerable & answered:      JUDGE(question, gold_answer, candidate, cited_chunk_contents) -> bool
```

**Verdict:** `pass = answer_correct && citation_valid && refusal_correct`. Aggregate `pass_rate = passed / total`, plus `by_category` breakdowns for `answerable`, `trap`, `multi_hop`, and by language (`he`, `en`).

### 5.2 The judge (`src/eval/judge.ts`)

Invoked **only** for answerable + answered fixtures. `claude-opus-4-8`, structured output:

```ts
export interface JudgeInput { question: string; goldAnswer: string; candidateAnswer: string; citedChunkContents: string[]; }
export interface JudgeVerdict { correct: boolean; rationale: string; }
```
Judge prompt: "Grade whether the candidate answer is **factually correct relative to the gold answer** for a question about Israeli labor law. Grade **only** factual correctness — not style, length, or language (Hebrew and English answers are both acceptable). The candidate is correct if it conveys the key facts of the gold answer without contradicting them or adding unsupported claims. Return `{correct, rationale}`." Grading against a gold answer + explicit criteria (rather than open-ended preference) is what keeps the LLM-judge honest and reduces self-preference bias. Persist `judge_rationale` — showing *why* fixtures failed is a transparency differentiator.

### 5.3 Harness (`src/eval/run.ts`) + CLI gate

`runEval({ corpusSlug, config, gitSha })`:
1. Insert an `eval_runs` row (`status='running'`).
2. For each fixture: retrieve → answer → deterministic checks → judge (only where required) → insert `eval_results` (accumulate `cost_usd`, `latency_ms`).
3. Update the run row: totals, `pass_rate`, `by_category`, `cost_usd`, `status='completed'`.
4. Print a summary table and the overall pass-rate.

**`npm run eval`** wraps `runEval` for the **current git SHA**, prints the pass-rate, and **exits non-zero if `pass_rate < TARGET` (0.90)** — this is the "tests gate code" mechanism. Also expose `POST /api/eval/run` (async) for the hosted demo. Enforce a per-run cost cap from `src/lib/cost.ts`.

### 5.4 Fixtures (`src/eval/fixtures/`)

Author ~35 fixtures as JSON/YAML, seeded via `scripts/seed-fixtures.ts`. Required spread:
- **Answerable** (He + En) with `gold_answer` and `expected_doc_ids`/`expected_chunk_ids` — the bulk.
- **Traps** (He + En) — plausible-sounding but **not** in the corpus (e.g. "What is the minimum wage in France?", "כמה ימי חופשה מגיעים לפי חוק העבודה בגרמניה?"). Correct behavior = refuse.
- **Multi-hop** — answer requires combining two chunks/sections.
- Balance He/En so the per-language breakdown is meaningful (this is how Hebrew quality becomes visible).

---

## 6. API routes (Fastify) — every route with shapes

All bodies validated with zod. Admin routes behind a simple bearer/basic auth (`src/api/auth.ts`, `ADMIN_TOKEN` env). File layout under `src/api/routes/`.

**Health**
- `GET /health` → `{ ok: true, db: 'up'|'down' }`

**Documents / ingestion (admin)** — `routes/documents.ts`
- `POST /api/documents` (multipart: file + `corpusSlug`, optional `declaredLang`) → `{ documentId, status }`
- `GET  /api/documents?corpus=labor-rights` → `[{ id, filename, sourceLang, status, chunkCount, error, indexedAt }]`
- `GET  /api/documents/:id` → full row + chunk count + first-page preview
- `POST /api/documents/:id/reingest` → `{ documentId, version, status }`
- `DELETE /api/documents/:id` → `{ deleted: true }`

**Corpus (admin + read)** — `routes/corpus.ts`
- `GET /api/corpus/:slug/status` → `{ slug, activeVersion, documents: N, chunks: N, indexed: N, failed: [{ id, filename, error }] }`  ← powers the admin view's failed-parse queue.
- `POST /api/corpus/:slug/reingest` → re-ingest all source files under a new version, flip active pointer → `{ version }`

**Chat** — `routes/chat.ts`
- `POST /api/chat` body `{ question: string, corpusSlug: string, corpusVersion?: number }` →
  ```jsonc
  { "refused": false,
    "answer": "…",
    "citations": [{ "chunkId": 812, "documentId": 5, "filename": "hofesh-shana.he.pdf",
                    "quote": "…", "pageStart": 3, "heading": "…" }],
    "retrieved": [{ "chunkId": 812, "similarity": 0.79, "content": "…" }],
    "usage": { "inputTokens": 2731, "outputTokens": 288 },
    "costUsd": 0.0094, "latencyMs": 1420, "model": "claude-sonnet-5" }
  ```
  (MVP non-streaming; SSE streaming is a later polish item.)

**Eval** — `routes/eval.ts`
- `POST /api/eval/run` body `{ corpusSlug, config? }` → `{ runId }` (runs async)
- `GET  /api/eval/runs` → `[{ id, gitSha, passRate, passed, total, byCategory, answeringModel, costUsd, finishedAt }]` (history)
- `GET  /api/eval/runs/:id` → run + `results: [{ fixtureId, question, category, lang, verdict, refused, answerCorrect, citationValid, refusalCorrect, judgeRationale }]`
- `GET  /api/eval/latest` → latest completed run summary (**powers the public report page**)
- `GET  /api/eval/fixtures` (admin) → list; `POST /api/eval/fixtures` (admin) → seed

---

## 7. Web UI (Vite + React, bilingual) — spec only, build last

Three pages. Keep it minimal; the substance is the backend + evals. i18n via `web/src/i18n/{he,en}.json`; a language toggle sets `<html lang dir>` (RTL for Hebrew). `web/src/lib/api.ts` wraps the routes above.

- **`Chat.tsx`** — question box + answer with **inline citation chips**; clicking a chip opens `CitationCard.tsx` showing the source chunk (filename, page, quote). Refusals render distinctly ("not in the corpus"). This visibly demonstrates the guardrail.
- **`Admin.tsx`** — corpus status: documents table (status, chunk counts, language), a **failed-parse queue**, upload + reingest buttons. Behind admin auth.
- **`EvalReport.tsx`** — **the centerpiece, public.** Reads `GET /api/eval/latest` + `GET /api/eval/runs`:
  - Big **current pass-rate** vs the 90% target (green/red).
  - **Per-category bars**: answerable, trap-refusal, multi-hop, Hebrew, English (this is where Hebrew quality is legible).
  - **History** sparkline/line over commits (`git_sha` on the x-axis).
  - A **failing-fixtures table** with the judge's rationale (radical transparency = the differentiator).
  - Run metadata: models, `topK`, `minSimilarity`, rerank on/off, cost.
  - (When building charts, load the `dataviz` skill for palette/consistency.)

### 7.1 Hosting (free-tier; must stay live)

- **DB:** **Neon** free tier — pgvector on all plans; scale-to-zero **auto-resumes on next connection** (no manual un-pause). Verify the exact free compute-hours at signup. *(Alternative: Supabase, but free projects pause after ~7 days idle and need manual/API reactivation — only choose it if you add a scheduled keep-alive ping.)*
- **API + web:** a free-tier host that tolerates cold starts (e.g. Render free web service, or Fly.io) serving the Fastify API; the built Vite app can be static-hosted (Vercel/Netlify/Render static) pointing at the API. Pick one host to keep CORS/setup simple. Accept cold-start latency on the demo.

---

## 8. Commit-by-commit build sequence

Each commit: `/kit:worktree` branch → implement → **done-probe passes** → `/kit:code-review` → commit. `fix:` commits carry a regression test. From C9 onward, any prompt/retrieval/chunking/rerank change **re-runs `npm run eval` and reports the pass-rate in the commit body**.

| # | Commit | Deliverable | **Done-probe (runnable → expected)** |
|---|---|---|---|
| C1 | `chore: scaffold` | package.json, tsconfig (strict), `src/config/{models,env}.ts`, Fastify boot, Neon pool, `.env.example` | `npm run dev` then `curl localhost:PORT/health` → `{"ok":true,"db":"up"}` |
| C2 | `feat: db schema + migrations` | `schema.sql`, `migrate.ts`, `corpora` seed row | `npm run migrate` then `psql "$DATABASE_URL" -c "\d chunks"` → shows `embedding vector(1024)` + `chunks_embedding_hnsw` |
| C3 | `feat: voyage embed + token/cost libs` | `lib/voyage.ts`, `lib/tokens.ts`, `lib/cost.ts` | `npm run scratch:embed "שלום עולם"` → prints vector length `1024`; `count_tokens` helper returns an int |
| C4 | `feat: ingestion pipeline` | parsers (pdf/docx/html/md), chunker, embedder, `ingest/index.ts` | `npm run ingest -- corpus/labor-rights/hofesh-shana.he.pdf` → doc `status='indexed'`, `SELECT count(*) FROM chunks` in expected range (e.g. 8–40) |
| C5 | `feat: retrieval` | `retrieve/retrieve.ts` + §2 SQL | `npm run scratch:retrieve "כמה ימי חופשה"` → prints top-5 chunks, `similarity` descending, all ≥ threshold |
| C6 | `feat: answer + hard guardrail` | `answer/answer.ts`, `answer/prompt.ts`, structured output, citation post-validation | `scratch:ask "מה שכר המינימום?"` → answer with ≥1 valid citation; `scratch:ask "minimum wage in France?"` → **refusal**, empty citations |
| C7 | `feat: demo corpus + seed` | `corpus/labor-rights/*` (He+En sources), `scripts/seed-corpus.ts` | `npm run seed:corpus` → all docs `indexed`, `GET /api/corpus/labor-rights/status` shows N docs / M chunks / 0 failed |
| C8 | `feat: eval fixtures` | ~35 fixtures (answerable/trap/multi-hop, He+En), `scripts/seed-fixtures.ts` | `npm run seed:fixtures` → `SELECT category, count(*) FROM eval_fixtures GROUP BY 1` shows the required spread |
| C9 | `feat: eval harness + gate` | `eval/{rubric,judge,run}.ts`, `npm run eval`, run/result persistence | `npm run eval` → prints per-category table + overall pass-rate; **exits non-zero if < 0.90**; a row appears in `eval_runs`. Record the **baseline** pass-rate. |
| C10 | `feat: api routes + admin auth` | `api/server.ts`, `routes/*`, `auth.ts` | `POST /api/chat` returns the §6 shape; `POST /api/eval/run` returns `{runId}`; admin routes 401 without token |
| C11 | `feat: tune retrieval+prompt to ≥90%` (+ optional `rerank`) | iterate `minSimilarity`, `topK`, prompt, chunking; add `rerank-2.5` if needed | `npm run eval` → **pass-rate ≥ 0.90**; commit body reports before→after and rerank on/off numbers |
| C12 | `feat: web chat (bilingual)` | `web/` Vite app, `Chat.tsx`, `CitationCard.tsx`, i18n, RTL | load the app, ask a He and an En question → cited answers render; a trap → visible refusal |
| C13 | `feat: web admin corpus view` | `Admin.tsx`, failed-parse queue, upload/reingest | upload a doc in the UI → appears with live status; a deliberately broken file → shows in failed queue |
| C14 | `feat: public eval report page` | `EvalReport.tsx` (pass-rate, per-category, history, failing-fixtures + rationale) | open `/evals` → shows latest pass-rate vs 90%, category bars, history line, failing rows with judge rationale |
| C15 | `chore: deploy + docs + final eval` | Neon prod, host API+web, README, optional scheduled eval, monthly cost counter | public URL serves the demo + eval page; `npm run eval` against prod ≥ 0.90; README documents setup + `/evals` link |

> Eval-first ordering: C9 lands the harness **before** any tuning (C11+). It reports a baseline immediately after the first working answer path, and gates every subsequent prompt/retrieval change — exactly the "tests gate code" discipline the brief asks for.

---

## 9. External-setup checklist for Nadav

> Per Nadav's global preference, **surface these ONE step at a time during implementation and wait for "done"** before giving the next. Listed here in order with cost expectations.

1. **Anthropic API key** — console.anthropic.com → create key → set `ANTHROPIC_API_KEY`. Cost: pay-as-you-go; projected **~$2–5/mo** at the chosen config (§1.4).
2. **Voyage AI key** — voyageai.com (now MongoDB) → create key → set `VOYAGE_API_KEY`. Cost: **200M free tokens (one-time)**; **~$0** at demo scale.
3. **Neon Postgres** — neon.tech → new project → copy the pooled connection string → set `DATABASE_URL`. Confirm pgvector is available (`CREATE EXTENSION vector;`). Cost: **free tier**. (Note the free compute-hours shown at signup.)
4. **Admin token** — pick a random string → set `ADMIN_TOKEN` (guards upload/reingest/fixture routes).
5. **Hosting** — one free-tier host for the Fastify API (Render/Fly) + static hosting for the Vite build (or same host). Set `API_BASE_URL` for the web app. Cost: **free tier** (accept cold starts).
6. **(Optional) GitHub Actions** — scheduled/biweekly `npm run eval` against prod, to keep the eval report's history fresh. Cost: **free** (Actions minutes) + the per-run API cost (§1.4).

Store secrets in `.env` locally (git-ignored) and the host's secret manager in prod. `.env.example` (C1) lists every variable.

---

## 10. Risks + later phases

**Risks (with mitigations):**
- **Hebrew PDF extraction quality (#1 risk).** RTL, ligatures, and embedded fonts can produce garbled/empty text. Mitigate: test extraction on real Hebrew PDFs in C4; **fail loudly** (failed-parse queue) rather than indexing garbage; prefer HTML/MD sources for Hebrew; quantify quality via the eval's Hebrew category. Fallback (later): OCR (e.g. a cloud OCR pass) for scanned/garbled Hebrew.
- **LLM-judge self-preference bias.** Judge (`opus-4-8`) is a different, stronger tier than the answerer (`sonnet-5`) and grades against an explicit gold answer + rubric, not open-ended preference. Mitigate further: spot-check judge verdicts against human judgment on a sample; keep `judge_rationale` visible for scrutiny.
- **Cost overrun from demo traffic.** Config-driven model choice, bounded fixtures, biweekly eval, per-run cost cap, monthly counter on the eval page. Haiku fallback available for utility tasks.
- **Neon scale-to-zero / free-host cold starts.** Acceptable for a portfolio demo; optional keep-alive ping if "instant" matters. (If Supabase is ever chosen, it *pauses after ~7 days idle* — Neon avoids that.)
- **Retrieval threshold tuning.** `minSimilarity` too low → answers ungrounded traps; too high → over-refuses. This is exactly what the trap + answerable eval categories tune; do not hardcode blindly — pick the value that maximizes overall pass-rate in C11.

**Later phases (explicit non-goals for MVP):**
- Reranking always-on / hybrid search (BM25 + vector).
- Corpus connectors (Google Drive, Notion).
- Agentic tool-use beyond retrieval.
- "Bring your own docs" trial mode (upload → transient corpus → ask).
- SSE streaming answers + richer UI polish.
- Multi-tenant auth beyond the single admin token.
- OCR fallback for scanned Hebrew documents.
- Fine-grained eval categories (numeric-fact accuracy, citation-precision@k).

---

## 11. Plan-done checklist (from BRIEF.md)

- [x] `docs/plan.md` committed, self-sufficient for a zero-context Opus 4.8 session.
- [x] Schema, pipeline interfaces, routes, and eval rubric written out with types — no "TBD"s.
- [x] Model + embedding choices made with **verified current pricing** and a **real cost estimate** (§1.2, §1.4).
- [x] Done-probes are runnable commands with expected outputs (§8).
- [x] Nadav's open decisions asked and answered (name **Asmakta**, corpus **Israeli labor rights**, target **90%**, ceiling **~$5/mo**).

*Sources verified 2026-07-06: Anthropic model/pricing via the bundled `claude-api` reference; Voyage models/pricing/SDK via docs.voyageai.com + platform.claude.com/…/embeddings + github.com/voyage-ai/typescript-sdk; pgvector types/limits/operators/DDL via github.com/pgvector/pgvector; hosting via Neon/Supabase/Railway/Fly docs. Flagged unknowns: no Hebrew-specific Voyage benchmark exists; `voyage-context-4` price and exact TS `rerank()` field names unverified — confirm at implementation.*
