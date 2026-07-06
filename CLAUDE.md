# CLAUDE.md — rag-assistant (portfolio project: RAG assistant with visible evals)

One of Nadav's freelance portfolio projects (backend dev going freelance; portfolio strategy derived from a July 2026 XPlace market scan).

**Current state: no code yet. The first and only pending task is producing the implementation plan.** When Nadav says "run", "start", "make the plan", or anything similar — read `BRIEF.md` and follow it exactly. The brief's constraints (PLAN ONLY, no application code) override any instinct to start building.

## Durable project rules

- Process skills come from the global `nadav-claude-kit` plugin (`/kit:*`); review rubrics accumulate in `.claude/review-rubrics/`.
- All LLM calls use the Anthropic API; keep model IDs in one config module — never scattered. All Q&A with Nadav happens in English; demo UI is bilingual Hebrew/English (Hebrew documents are a differentiator).
- Implementation (later, by Opus 4.8 sessions) works via `/kit:worktree` branches with `/kit:code-review` before every commit; `fix:` commits carry a regression test. Changes to prompts/retrieval logic must re-run the eval suite and report the pass-rate in the commit body (same discipline as click-bateva's agent-eval rule).
- Infra must stay free-tier friendly except LLM/embedding API costs (Nadav approves those per-run).
