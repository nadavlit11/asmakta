# CLAUDE.md — rag-assistant (portfolio project: RAG assistant with visible evals)

One of Nadav's freelance portfolio projects (backend dev going freelance; portfolio strategy derived from a July 2026 XPlace market scan).

**Current state: implementation plan complete → [`docs/plan.md`](docs/plan.md). Planning is done; the next task is implementation, by fresh Opus 4.8 sessions.** When Nadav says "run", "start", "build", or "next commit" — read `docs/plan.md` and execute its commit sequence (§8) in order: one `/kit:worktree` branch per commit, each commit's done-probe passing, `/kit:code-review` before every commit. From commit C9 onward, any change to prompts/retrieval/chunking/rerank must re-run `npm run eval` and report the pass-rate in the commit body. `BRIEF.md` holds the original planning brief (historical context).

## Durable project rules

- Process skills come from the global `nadav-claude-kit` plugin (`/kit:*`); review rubrics accumulate in `.claude/review-rubrics/`.
- All LLM calls use the Anthropic API; keep model IDs in one config module — never scattered. All Q&A with Nadav happens in English; demo UI is bilingual Hebrew/English (Hebrew documents are a differentiator).
- Implementation (later, by Opus 4.8 sessions) works via `/kit:worktree` branches with `/kit:code-review` before every commit; `fix:` commits carry a regression test. Changes to prompts/retrieval logic must re-run the eval suite and report the pass-rate in the commit body (same discipline as click-bateva's agent-eval rule).
- Infra must stay free-tier friendly except LLM/embedding API costs (Nadav approves those per-run).
