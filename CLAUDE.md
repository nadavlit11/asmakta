# CLAUDE.md — rag-assistant (portfolio project: RAG assistant with visible evals)

One of Nadav's freelance portfolio projects (backend dev going freelance; portfolio strategy derived from a July 2026 XPlace market scan).

**Current state: implemented and merged to `main` (plan C1–C15). The app is built** — ingestion → pgvector retrieval → answer-with-citations guardrail → eval harness, Fastify API, and the bilingual React UI. Eval passes 47/47 (100%, target 90%). Remaining: deploy to hosting (Neon + a host — needs Nadav's accounts); optionally swap the illustrative demo corpus for authoritative sources. Ongoing rule: any change to prompts/retrieval/chunking/rerank must re-run `npm run eval` and report the pass-rate in the commit body; use `/kit:worktree` + `/kit:code-review` for new work. `docs/plan.md` is the design reference; `BRIEF.md` is the original planning brief (historical).

## Durable project rules

- Process skills come from the global `nadav-claude-kit` plugin (`/kit:*`); review rubrics accumulate in `.claude/review-rubrics/`.
- All LLM calls use the Anthropic API; keep model IDs in one config module — never scattered. All Q&A with Nadav happens in English; demo UI is bilingual Hebrew/English (Hebrew documents are a differentiator).
- Implementation (later, by Opus 4.8 sessions) works via `/kit:worktree` branches with `/kit:code-review` before every commit; `fix:` commits carry a regression test. Changes to prompts/retrieval logic must re-run the eval suite and report the pass-rate in the commit body (same discipline as click-bateva's agent-eval rule).
- Infra must stay free-tier friendly except LLM/embedding API costs (Nadav approves those per-run).
