# AGENTS.md — floor-plan-reviewer

Comprehensive guide for AI assistants working in this repo. `CLAUDE.md` points here; this file is
the source of truth for the workflow, boundaries, and conventions. **There is no app to run: the
docs plus one renderer script ARE the agent.** A Claude Code chat session in this repo executes the
workflow below.

---

## What this project is

Take an existing property's floor plan (a listing-style image) and iteratively propose layout
changes that **maximise achievable weekly rent** — without changing the land boundary or external
building envelope unless the property's scope explicitly stipulates otherwise.

Reference example: `231-peats-ferry-rd/` (NSW). `original.png` is the listing plan (3 bed, 1 bath,
garage, large balcony). `propose_v1.png` is a **hand-drawn concept that predates this pipeline**
(garage → bed + walk-in robe + ensuite; balcony enclosed → new living/kitchen; ensuite + WIR added
to Bed 1; new entry) — it defines the visual style the renderer reproduces, and is kept as-is.

## Locked decisions (v1)

| # | Decision | Choice |
|---|----------|--------|
| A | Harness | Claude Code chat in this repo — docs-as-agent, no standalone app yet |
| B | Market | NSW, Australia — all rents in **AUD $/week** |
| C | Input | Listing-style floor-plan image(s); one folder per property |
| D | Immutable envelope | Land boundary, external walls, roofline never change unless `scope.md` stipulates |
| E | Default change types | Repurpose rooms / move internal walls · garage & balcony conversion · new wet areas. **Dual-occupancy split only if stipulated.** Confirmed per property, never one-size-fits-all |
| F | Scope lock | Agent drafts `scope.md` → user confirms in chat → status LOCKED |
| G | Iteration | One impact per iteration; cumulative versions `v01, v02, …` (+1 each time) |
| H | Rendering | Two Pillow renderers: `render_overlay.py` (red-box **delta** view from `changes_v##.json`) and `render_plan.py` (styled **result** redraw from `plan_v##.json`; style reference `examples/floorplan-styling.webp` — reproduce the style, never third-party branding/logos) |
| I | Rent estimates | **Live web comparables only** — cited with URL + access date; never invented |
| J | Objective | Pure weekly-rent maximisation; no cost/ROI modelling in v1 |
| K | Compliance | Advisory flags only (exempt / CDC / DA / specialist) + habitability notes; never blocking |

## Core invariants — never break these

1. **Envelope is immutable.** Never alter the land boundary, external building envelope, or
   roofline unless `scope.md` for that property explicitly stipulates it.
2. **Scope is a contract.** Never propose a change type outside the locked `scope.md`. Widening
   scope requires the user to re-confirm `scope.md` (record the change in its changelog).
3. **`original.png` is never modified.** All renders are new files.
4. **One impact per version.** Version numbers are zero-padded, monotonic, +1 only. Only the
   *latest* version may be revised (on explicit request); earlier versions are frozen history and
   are never deleted or overwritten.
5. **Rent claims need evidence.** Every rent figure cites ≥ 3 live comparable listings (config,
   $/week, URL, access date) — or explicitly states fewer were found and flags reduced confidence.
   If web access is unavailable, pause and say so; never fill the gap with a guess.
6. **Compliance flags stick.** Every change carries its advisory flags in `changes_v##.json` and
   `propose_v##.md`, and they are never dropped in later versions.
7. **Not advice.** Proposals are concept drawings for investment brainstorming — not architectural,
   planning, or financial advice. `scope.md` and `SUMMARY.md` carry a one-line disclaimer.

## The workflow

### Chat interaction contract

| User says | Agent does |
|-----------|------------|
| `Review <property-folder>` | Run the pipeline from wherever that folder's state left off (see Resume rules) |
| `continue` / `next` | Propose the next impact → version +1 |
| `revise v## …` | Redo that version in place — allowed for the **latest** version only |
| `change scope …` | Unlock `scope.md`, agree changes, re-confirm, log in its changelog, then continue |
| `stop` / `finalise` | Write `SUMMARY.md` and end the run |

### Phase 0 — Intake

A property = a folder in the repo root named as an address slug (e.g. `231-peats-ferry-rd/`)
containing `original.png`. Read the image, record its native pixel size, and build a room
inventory: name, dimensions (m), approximate area, plus fixed elements that anchor everything else
(wet-area stack, entry, stairs, plumbing walls). v1 assumes a single plan image per property;
multi-storey is on the roadmap.

### Phase 1 — Scope (draft → confirm → lock)

Draft `scope.md` **for this property**: the room inventory, the levers you can see (e.g. garage,
balcony, oversized living), which of the default change types (decision E) apply here, exclusions,
and assumptions. Present it in chat and ask the user to confirm or edit. Only when confirmed, set
`Status: LOCKED (YYYY-MM-DD)`. Never start proposing before the lock.

### Phase 2 — Baseline rent

Estimate the property's current weekly rent from **live comparables only** (see Rent method).
Write `rent_baseline.md`: comps table with URLs, adjustments, and a baseline range + point
estimate. All later uplift is measured against this.

### Phase 3 — The iteration loop (one impact per version)

For each iteration `NN = previous + 1` (starting at `01`):

1. **Pick one impact** — the highest-rent-uplift change consistent with the locked scope that
   hasn't been done yet.
2. **Write `changes_vNN.json`** — copy all changes from `changes_v(NN-1).json` and append the new
   one (`added_in_version: NN`). The file is cumulative; see the schema section.
3. **Render** — `uv run python scripts/render_overlay.py <folder>/changes_vNN.json` →
   `propose_vNN.png`. If the property maintains a styled plan (231-peats-ferry-rd does from v02
   on), update the geometry to match and run
   `uv run python scripts/render_plan.py <folder>/plan_vNN.json` → `propose_vNN_plan.png`.
4. **Self-check** — Read the rendered PNG. If boxes sit over the wrong rooms or labels clip,
   adjust coordinates and re-render before showing the user. Boxes are pixels at `original.png`'s
   native resolution; estimate them from wall lines and the printed room dimensions.
5. **Re-estimate rent** — find live comps matching the **new** configuration (e.g. 4 bed / 2 bath
   after a garage conversion) and attribute the uplift.
6. **Write `propose_vNN.md`** — the paper trail (template below).
7. **Present in chat** — the image path, the impact, the rent movement, the compliance flags. Then
   wait: `continue`, `revise`, or `stop`.

Stop proposing when the marginal uplift is exhausted — say so rather than inventing weak changes.

### Phase 4 — Summary

On `stop`, write `SUMMARY.md`: version-by-version journey (impact + rent after each), final
configuration vs original, total uplift $/week, all compliance flags, and the disclaimer.

### Resume rules

On `Review <folder>`: if `scope.md` is missing or not LOCKED → Phase 1. Else if
`rent_baseline.md` is missing → Phase 2. Else resume Phase 3 at
`max(NN in changes_v*.json) + 1`. Never renumber or backfill.

## Property folder contract

```
231-peats-ferry-rd/
├── original.png          # input — immutable
├── scope.md              # per-property boundaries; drafted by agent, LOCKED by user
├── rent_baseline.md      # current-config comps + baseline $/week
├── changes_v01.json      # cumulative change set (renderer source of truth)
├── propose_v01.png       # rendered overlay — the headline deliverable
├── propose_v01.md        # paper trail: impact, rationale, comps, flags
├── changes_v02.json      # = v01 changes + one new impact …
├── propose_v02.png
├── propose_v02.md
├── plan_v02.json         # styled-plan geometry in metres (result view source of truth)
├── propose_v02_plan.png  # clean listing-style redraw of the proposed layout
└── SUMMARY.md            # written on stop/finalise
```

(`231-peats-ferry-rd/propose_v1.png` — unpadded — is the legacy hand-drawn concept, not pipeline
output.)

### `scope.md` template

```markdown
# Scope — <address>
**Status:** DRAFT | LOCKED (YYYY-MM-DD)

## Property facts
<beds/baths/cars, room inventory table: room · dims · ~area, plan image px size>

## Fixed elements
<wet stack, entry, stairs, anything that anchors the layout>

## Levers identified
<e.g. single garage 3.0×10.8 · balcony 7.5×2.9 · combined kitchen/dining>

## Allowed change types for THIS property
- [x/ ] repurpose rooms / move internal walls
- [x/ ] garage & balcony conversion
- [x/ ] new wet areas (plumbing)
- [ ] dual-occupancy split (only if stipulated here)

## Stipulations & exclusions
<user-specific rules, e.g. "keep at least 1 covered car space">

## Assumptions
<ceiling heights, structural guesses — anything unverified>

## Changelog
- YYYY-MM-DD locked by user in chat

*Concept scoping only — not architectural, planning, or financial advice.*
```

### `propose_v##.md` template

```markdown
# propose_v02 — <address>
**This impact:** <the one change added in this version>
**Cumulative:** c01 <title> · c02 <title>
**Configuration after:** X bed / Y bath / Z car

## Rationale
<why this is the next-biggest rent lever>

## Compliance flags (advisory)
<pathway: exempt/CDC/DA/specialist + habitability notes>

## Rent evidence (accessed YYYY-MM-DD)
| Comparable | Config | $/week | Source |
|---|---|---|---|
| <suburb + street> | 4b/2b/1c | $XXX | <URL> |

**Estimated weekly rent:** $XXX–$YYY (baseline $BBB → cumulative uplift +$UU/week)
```

## `changes_v##.json`

Schema: [`schema/changes.schema.json`](./schema/changes.schema.json). Cumulative — version N
contains every change from 1..N, so any version renders standalone. Minimal example:

```json
{
  "version": 1,
  "property": "231-peats-ferry-rd",
  "base_image": "original.png",
  "changes": [
    {
      "id": "c01",
      "added_in_version": 1,
      "kind": "convert",
      "title": "Garage → Bedroom 4 + WIR + ensuite",
      "rationale": "Adds a 4th bedroom without touching the envelope.",
      "rent_impact_per_week": 150,
      "compliance": { "pathway": "DA", "notes": ["habitable-room light/ventilation", "loses covered parking"] },
      "boxes": [
        { "x": 45, "y": 65, "w": 165, "h": 380, "label": "bed" },
        { "x": 48, "y": 450, "w": 160, "h": 70, "label": "ensuite" }
      ]
    }
  ],
  "rent": { "currency": "AUD", "baseline_per_week": 650, "proposed_per_week": 800 }
}
```

Render: `uv run python scripts/render_overlay.py <folder>/changes_vNN.json` (add `--out` to
preview elsewhere, e.g. into the scratchpad while aligning boxes). Boxes default to the
propose_v1 style — white fill, red border, centred black text; `"style": "outline"` keeps the
underlying plan visible.

## `plan_v##.json` (styled redraw)

The **result view**: the proposed layout redrawn as a professional listing-style plan (thick black
walls, caps room names + dims, grey outdoor/utility zones, address title block — style reference
`examples/floorplan-styling.webp`; never copy third-party branding). Geometry is in **metres**:
`rooms` are rectangles `{name, dims, x, y, w, h, fill?: "grey", z?: 1}` (z=1 nests robes/linen
inside a z=0 room); `openings` are white rectangles punched through walls; `fixtures` are
outlined, unfilled rectangles (island benches, cabinetry runs). **Every room shows dimensions**
(owner rule, 2026-07-12): the renderer auto-derives the dims line from the rectangle when `dims`
is empty — override it when the true room dims differ from the drawn rect, or set `"-"` to
suppress; the dims line is dropped before the name if a room is too small for both. Walls derive from room
outlines — rooms sharing an edge get an internal partition automatically; small gaps between
rooms just read as thicker wall mass. Internal floor area is auto-summed from non-grey z=0 rooms.
Render: `uv run python scripts/render_plan.py <folder>/plan_vNN.json` → `propose_vNN_plan.png`.
Self-check the output image and iterate coordinates the same way as overlay boxes.

## Rent method (live comparables only)

- Search current rental listings (Domain, realestate.com.au, etc.) for the same suburb (or
  adjacent), same dwelling type, within ±1 bedroom of the configuration being priced.
- Record per comp: street/suburb, beds/baths/cars, advertised $/week, URL, access date.
- Target ≥ 3 comps; adjust qualitatively (condition, land, location) and state the adjustment.
- Output a range plus a point estimate; keep the arithmetic visible.
- Never fabricate a listing. No web access → pause the rent step and tell the user.

## Compliance flags (NSW, advisory only)

Tag every change with a likely approval pathway — this informs, it never blocks:

- **exempt** — minor internal non-structural work.
- **CDC** — complying development (fast-track certifier approval) plausible.
- **DA** — council development application likely (e.g. change of use, parking loss).
- **specialist** — structural/hydraulic advice needed before pathway is knowable.

Habitability rules of thumb to note where relevant: ~2.4 m ceilings for habitable rooms; natural
light glazing ≈ 10% of floor area and ventilation ≈ 5%; garage conversions raise floor level/damp,
insulation, and window questions; balcony enclosures raise structural, waterproofing, and BASIX
questions; new wet areas need waterproofing certification and drainage runs. Always phrase as
"verify with a certifier/council" — this repo is not a planning authority.

## Repo conventions

- **Python:** ≥ 3.11, managed with `uv` (`uv sync`, `uv run …`) — never raw pip.
- **Quality:** `uv run ruff format . && uv run ruff check . --fix` · `uv run mypy scripts` (strict).
- **Tests:** pytest in `tests/` (renderer unit tests are on the roadmap).
- **Secrets:** none required for v1; if any appear, `.env` only, never committed.
- Property folders contain only the contract files above; scratch/preview renders go to the
  session scratchpad, not property folders.

## Roadmap (later phases — not v1)

1. Renderer unit tests + `jsonschema` validation of `changes_v##.json`.
2. Multi-storey support (several plan images per property).
3. Dual-occupancy module (second kitchen + separate entry) as an opt-in scope stipulation.
4. Optional cost/ROI overlay (decision J revisited) and budget caps.
5. Styled-plan renderer polish: door swing arcs, window breaks, compass, site-plan panel.
6. **Floor-Plan Studio web app** — plan APPROVED 2026-07-12, spec in
   [`ai_specs/s01_floorplan-studio-plan.md`](./ai_specs/s01_floorplan-studio-plan.md): `app/`
   subfolder, React + d3 SVG canvas, FastAPI + Pydantic AI, Postgres, phases P0–P6 ending in AWS
   App Runner like data-qa-agent.
