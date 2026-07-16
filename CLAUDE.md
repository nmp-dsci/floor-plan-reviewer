# CLAUDE.md — floor-plan-reviewer

> 📖 **Read [`AGENTS.md`](./AGENTS.md) first** — it is the source of truth: locked decisions, core
> invariants, the phased workflow, the property-folder contract, templates, rent method, and NSW
> compliance flags. `README.md` covers the human-facing quick start. This file is just a pointer
> plus the quick reference.

A chat-driven agent workflow (this repo's docs ARE the agent — there is no app): give it a
property folder containing a floor-plan image and it iteratively proposes layout changes that
maximise achievable weekly rent (AUD $/week, NSW), strictly within the existing building envelope,
rendering each impact as an annotated `propose_v##.png`.

## Quick reference

- **Start/resume in chat:** `Review <property-folder>` · next impact: `continue` ·
  `revise v## …` (latest version only) · `stop` → writes `SUMMARY.md`
- **Pipeline per iteration:** one impact → `changes_v##.json` (cumulative) → render → self-check
  the PNG → live rent comps → `propose_v##.md` → present and wait
- **Render:** `uv run python scripts/render_overlay.py <folder>/changes_v##.json`
- **Setup / quality:** `uv sync` · `uv run ruff format . && uv run ruff check . --fix` ·
  `uv run mypy scripts`
- **Floor-Plan Studio app (`app/`):** `make -C app up` (compose: frontend host :5175, backend
  :8090, agent :8091, Postgres) · `make -C app test` (runs the golden-path gate first, then
  plan-core/plan-agent tests) · `make -C app golden` (231 PFR regression alone) · `make -C app
  smoke` · `make -C app reseed` (wipe → pristine v03) · demos `make -C app demo-whats-new` /
  `demo-tour` / `demo-videos` (narrated Playwright videos, predate the Drafting Ink 2.0 restyle) —
  spec: `ai_specs/s01_floorplan-studio-plan.md`. Review is a canvas-first workspace (tabbed
  EDIT/AGENT/HISTORY/RENT dock) per the "Drafting Ink" style guide
  (`.claude/skills/frontend-style/`); humans + agent share one validated op pipeline
  (`POST /reviews/{id}/edits` for human edits, `/comments` for the agent).
- **Never:** touch the external envelope/boundary/roofline unless `scope.md` stipulates · propose
  outside the locked `scope.md` · quote rent without ≥ 3 cited live comps (pause if no web access) ·
  modify `original.png` · revise anything but the latest version
