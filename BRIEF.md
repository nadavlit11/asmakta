# BRIEF — rag-assistant: produce the implementation plan

> **Current state (updated 2026-07-06): DONE.** The implementation plan is complete and committed at [`docs/plan.md`](docs/plan.md). Product name **Asmakta**; corpus **Israeli labor/employment rights**; eval target **90%**; monthly ceiling **~$5**. The next task is implementation, not planning — see `docs/plan.md` §8 for the commit sequence. This brief is retained as historical context for how the plan was scoped.

You (Claude Fable) are being used for PLANNING ONLY. The plan you write will be executed by **Opus 4.8 sessions with zero memory of this session** — write for a competent implementer who knows nothing about this project beyond what's in this repo.

## Context

Nadav is a backend developer building a freelance portfolio. The 2026-07-05 XPlace market scan (report: https://claude.ai/code/artifact/0379fb97-0af6-4c45-8c1f-4a83af3cf610) found a well-paying AI-systems cluster:

- Enterprise GenAI posting: "end-to-end ingestion pipeline — data extraction, smart parsing, vector-database indexing, retrieval against an LLM in a closed cloud." ₪50–100k budget, 41 bids, avg bid ₪37.5k.
- A steady ₪5–10k flow of AI agents / chatbot / "embed AI in our site" asks.

Nadav has already built this architecture in production elsewhere (an LLM agent with tool-use over Postgres + embeddings search, guardrails, and a weekly eval suite) — but that system is private. This project makes the capability **publicly legible**, and its differentiator is the thing no competitor shows: **a published eval report**.

## The product

A document-Q&A assistant, small but production-shaped:

1. **Ingestion pipeline**: upload PDF / DOCX / HTML / MD → parsing → chunking (strategy explicit and configurable) → embeddings → Postgres+pgvector index. Re-ingestion/versioning of a corpus. Hebrew AND English documents (Hebrew extraction quality is part of the demo).
2. **Chat assistant**: question → retrieval (top-k + threshold) → answer WITH inline citations to source chunks; a hard guardrail — no source, no answer ("I don't have this in the corpus"), never invented citations.
3. **Admin corpus view**: documents, chunk counts, index status, failed-parse queue.
4. **The eval harness (first-class feature, not an afterthought)**: a fixture set of Q&A pairs per demo corpus (incl. trap questions that AREN'T answerable from the corpus); automated run scoring answer correctness, citation validity, and refusal correctness; a **public eval-report page on the demo** showing the current pass-rate, per-category breakdown, and history. This page is the portfolio's centerpiece.

**Non-goals (MVP):** multi-tenant auth beyond a simple admin login, agentic tool-use beyond retrieval, fine-tuning, streaming UI polish beyond basics, connectors (Drive/Notion — later phase).

## What the plan must contain (docs/plan.md)

1. **Stack + model decisions with rationale**: Node/TypeScript, Postgres+pgvector leaning (Nadav's background: Fastify + Postgres; he has prior production experience with Voyage embeddings). Which Anthropic model for answering vs. eval-judging, which embedding model for Hebrew+English — check current model availability and pricing via docs/web, don't answer from memory; estimate per-demo-session and per-eval-run cost in actual numbers.
2. **Full code context** — critical, the implementer is a different model in a fresh session: DB schema (documents, chunks, embeddings, eval fixtures, eval runs — column types + index definitions incl. the pgvector index choice); ingestion pipeline stages as TypeScript interfaces; every API route with shapes; the eval scoring rubric (exact per-question verdict logic); file layout.
3. **Commit-by-commit build sequence** — eval harness lands EARLY (it gates the retrieval/prompt commits the way tests gate code), demo corpus + fixtures included; UI last.
4. **Executable done-probes per milestone**: e.g. ingest fixture PDF → chunk count in range; ask a fixture question → answer cites the right chunk id; ask a trap question → refusal; `npm run eval` → pass-rate ≥ target printed.
5. **External-setup checklist** for Nadav — one step at a time (Anthropic API key, embeddings key, hosting, DB) with cost expectations per step.
6. **Risks + later phases** (Hebrew PDF extraction quality, corpus connectors, agentic tools, the "bring your own docs" trial mode).

## Rules for this planning session

- PLAN ONLY. Do not write application code or scaffold the app. Deliverable: `docs/plan.md`, committed.
- Web research on models/pricing/pgvector practices is encouraged; verify against current docs rather than memory.
- When the plan surfaces decisions only Nadav can make (product name, demo corpus subject, eval pass-rate target, monthly cost ceiling), ask via AskUserQuestion (English) BEFORE finalizing.
- Finish by committing the plan + updating this file's "Current state" line to point at it.

## Plan-done checklist

- [ ] docs/plan.md committed, self-sufficient for a zero-context Opus 4.8 session
- [ ] Schema, pipeline interfaces, routes, and eval rubric written out with types — no "TBD"s
- [ ] Model + embedding choices made with verified current pricing and a real cost estimate
- [ ] Done-probes are runnable commands with expected outputs
- [ ] Nadav's open decisions asked and answered (or explicitly deferred by him)
