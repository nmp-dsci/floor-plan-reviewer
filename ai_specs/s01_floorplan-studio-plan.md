# Floor-Plan Studio — web app build spec

**Status: APPROVED 2026-07-12** (lavish review `.lavish/s01_floorplan-studio-plan.html`; decisions
D1–D4 locked by owner). This spec is self-contained: a developer/agent can implement from it.

## Goal

Turn the chat/lavish review loop (proven on `231-peats-ferry-rd`, v01–v03) into a local-first web
app: load a floor plan, interact with it as a **shape object**, queue comments against selected
objects, send to the agent, and watch the proposed plan, delta view, and a git-style change
register update version after version. Header-stats-plus-details layout, same visual language as
the s00 review page. Built to deploy to AWS later exactly like sibling `data-qa-agent`.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | App location | `app/` subfolder of this repo — chat workflow + app share `plan-core` and property folders |
| D2 | Plan canvas | **d3 + SVG** — every room/wall is a DOM node; selection, hover, diff colouring native |
| D3 | Backend & agent | **FastAPI + Pydantic AI** (mirrors data-qa-agent locked decision F); Claude, model config-swappable |
| D4 | Persistence | **Postgres in docker-compose from P0** — same engine as AWS RDS/Aurora later |

Open question (deliberately deferred to P6): auth provider — Cognito vs Entra External ID.

## Plan schema v2 — the shape object

One typed geometry model drives rendering, editing, and diffing. Evolution of `plan_v##.json`;
**walls become first-class**, derived once from room-rect adjacency (shared edges → segments
between junctions), then addressable. All coordinates metres; axis-aligned only (v1 constraint).

```jsonc
// room — as today, plus stable id + kind
{ "id": "bed-5", "kind": "bedroom", "name": "BED 5", "x": 3.1, "y": 6.25, "w": 4.0, "h": 4.35 }

// wall — derived at load, then first-class
{ "id": "w-bed5-hall-1", "a": "bed-5", "b": "hall",     // b may be "exterior"
  "line": [7.1, 6.25, 7.1, 10.6], "t": 0.12,
  "openings": [{ "id": "o-17", "type": "door", "t0": 0.42, "t1": 0.63 }] }

// selection target (comment attachment)
{ "targets": [
  { "type": "room", "id": "living" },
  { "type": "wall", "id": "w-living-kitchen-2", "t0": 0.32, "t1": 0.61 }  // a CHUNK
] }

// queued change-list item
{ "id": "q1", "targets": [ ... ], "text": "open this wall — servery window", "status": "queued" }
```

**Ids are stable across versions** — agent ops reuse ids for modifications, mint new ones for
additions. That makes diffing set comparison: `add` / `remove` / `modify` per room/wall/opening.

## Interaction spec

| Gesture | Result |
|---|---|
| Click room | Select room polygon |
| Click wall | Select whole segment (junction→junction); ~14px invisible hit-stroke |
| Drag handles on selected wall | Trim to a chunk (`t0–t1`), snap 0.05 — for remove/door/window |
| Long-press ≥400 ms, then clicks | Multi-select (rooms + walls mix); Shift-click = desktop equivalent |
| Selection + comment → Add | Pushes to change list with target chips (nothing sent) |
| Send | Submits batch; SSE progress; new version swaps in |
| Esc / empty click | Clear selection |

## Delta view & git-style register

- Delta view: proposed plan as base; **added** = green stroke/fill; **removed** = red dashed
  ghosts at old geometry; **modified** = outlined with `WAS → NOW` label. Toggle vs-original /
  vs-previous.
- Register rendered **from the diff** (never hand-written): one hunk per change carrying the
  workflow metadata (change id, title, rent impact, compliance flags), lines `-` red / `+` green,
  monospace. Example:

```
@@ c03 · lounge → bed 5                 +$120/wk @@
- room  lounge        5.2 x 4.3m   living
+ room  bed-5         4.0 x 4.3m   bedroom
+ open  hall→bed-5    0.9m         door
```

## Architecture (mirrors data-qa-agent)

- **frontend** — React + Vite + TS; d3 SVG canvas, delta view, register, change list. REST + SSE.
- **backend-api** — FastAPI; plans/reviews/versions/comments; SSE events; storage adapter
  (local volume → S3).
- **plan-agent** — Pydantic AI + Claude; applies comment batches via **typed geometry ops only**
  (`split_room`, `merge_rooms`, `set_kind`, `add_opening(wall,t0,t1,type)`,
  `remove_wall_chunk`, `add_fixture`, …) — never SVG/pixels. Vision ingest (P4), rent comps +
  compliance (P5).
- **plan-core** — shared Python lib: schema v2, wall derivation, diff engine, validation
  (no orphan openings, no room overlaps beyond wall tolerance, circulation reachability;
  invalid ops bounce back to the agent with reasons), Pillow PNG export reusing `scripts/`
  visual constants (incl. the dims-on-every-room rule) so SVG and PNG never drift.
- **Postgres** — plans, versions (immutable, head-only writes; stale submits rejected with a
  rebase prompt), comments, runs.

### API surface (v1)

| Endpoint | Purpose |
|---|---|
| `POST /plans` | Create from upload (image) or geometry JSON |
| `POST /plans/{id}/ingest` | Vision extraction job → schema-v2 draft (P4) |
| `GET /reviews/{id}` | Original, head, version list, register, rent stats |
| `POST /reviews/{id}/comments` | Submit queued batch → 202 + job id |
| `GET /reviews/{id}/versions/{n}` | Geometry + diff-vs-original + register |
| `GET /reviews/{id}/events` | SSE: job progress, `version.ready` |
| `GET /reviews/{id}/versions/{n}/export.png` | Pillow render — parity with chat workflow |

## Phases — every phase ends runnable locally (`make up`)

| Phase | Build | Acceptance |
|---|---|---|
| P0 Scaffold | compose (frontend, backend-api, plan-agent stub, Postgres); schema v2 + converter from `plan_v03.json`; d3 renderer matching Pillow look; room click-select; comment queue; echo agent | `make up` → load 231-peats-ferry-rd → select room → queue → Send → v04 (echo) appears |
| P1 Walls | wall derivation; segment/chunk hit-testing + handles; long-press multi-select; target chips | one comment carries room + wall-chunk targets |
| P2 Diff | object diff; delta view; generated git-style register | original vs v03 shows c01–c07 with no hand-written register |
| P3 Agent loop | Pydantic AI + Claude; typed ops + validator bounce-back; SSE; per-version rent stats | the v03 lavish session replayed entirely in-app |
| P4 Ingestion | upload PNG → vision extract → scale-confirm wizard (two known dims) → draft → approve (app's scope.md lock) | new property: image → reviewable geometry in one sitting |
| P5 Parity | rent comps + compliance per change; SUMMARY + PNG export; library page | app output matches repo paper-trail contract |
| P6 AWS | Terraform mirroring `data-qa-agent/infra/terraform`: App Runner ×3, RDS Postgres, S3+CloudFront, Secrets Manager, GH Actions deploy on main; auth decided here | merge to main deploys; compose and cloud shapes 1:1 |

## Repo layout

```
floor-plan-reviewer/
├── AGENTS.md · CLAUDE.md · scripts/ · 231-peats-ferry-rd/ · ai_specs/   # existing — untouched
└── app/
    ├── frontend/               # React + Vite + TS, d3 canvas, register, change list
    ├── services/
    │   ├── backend-api/        # FastAPI: REST + SSE, Postgres, storage adapter
    │   └── plan-agent/         # Pydantic AI + Claude: ops loop, ingest, comps (later)
    ├── packages/plan-core/     # schema v2, wall derivation, diff, validate, Pillow export
    ├── db/                     # migrations
    ├── docker-compose.yml
    └── Makefile                # make up / make smoke
```

## Risks & failure modes

1. **Image→geometry is the hardest ML step** → P4, behind library-first app, always through a
   human scale-confirm + approve wizard; fallback: edit draft or manual JSON.
2. **Wall-chunk UX** → whole-segment default; chunks only via drag handles; snapping; fat strokes.
3. **Geometry corruption** → all agent edits through plan-core validation with bounce-back;
   immutable versions; head-only writes.
4. **Rect-only model** → no diagonal/curved walls, single storey per plan object (multi-storey =
   one object per level, later).
5. **Two renderers, one look** → plan-core owns shared style constants.
