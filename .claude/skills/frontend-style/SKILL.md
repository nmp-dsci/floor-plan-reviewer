---
name: frontend-style
description: Floor-Plan Studio design system ("Drafting Ink") — load before creating or modifying anything under app/frontend/. Tokens, type scale, component recipes, canvas rules, and do/don't rules for all UI work.
---

# Drafting Ink — Floor-Plan Studio design system

Architectural-drafting aesthetic: the plan's black linework IS the brand. UI chrome stays
monochrome ink-on-paper so the two accents keep fixed meanings: **red = selection / negative
change / destructive**, **green = positive change** (rent uplift, additions). A rent delta is
green when positive and red when negative — everywhere it appears.
Chosen over "Blueprint" (dark technical) and "Editorial Estate" (serif listing) in the
2026-07-12 frontend review (`.lavish/s03_frontend-shared-editing-plan.html`).

## Tokens

Single source of truth: `app/frontend/src/styles.css` `:root`. Never introduce a colour,
font, or spacing value that isn't a token. Current set:

| Token | Value | Use |
|---|---|---|
| `--ink` | `#141416` | text, borders, walls, primary buttons |
| `--paper` | `#ffffff` | page + canvas background |
| `--grey` | `#e1e1e3` | hairlines, disabled borders, room grey-fill |
| `--grey-2` | `#f4f4f5` | recessed panels (comment panel, banners, sub-bars) |
| `--faint` | `#74747a` | secondary text, dims labels, hints |
| `--red` | `#e23d28` | selection, negative rent change, destructive, hover-primary |
| `--green` / `--green-bg` | `#1a7f37` / `#e6f4ea` | diff additions, positive rent change / uplift |
| `--red-bg` | `#fdecea` | diff removals |
| `--amber` | `#9a6700` | diff modifications, warnings, busy states |
| `--mono` | SF Mono stack | ALL numbers, dims, diffs, ids, version labels |
| sidebar ink-surface | `#232327` hover · `#3a3a3e` rules · `#9c9ca4` muted text · `#7ee2a8` positive-on-ink · `#ff8a75` negative-on-ink | dark sidebar only |

## Type scale

- Family: `'Helvetica Neue', Arial, sans-serif`; numerals/code/dims always `var(--mono)`.
- Page title: 24–26px, **uppercase**, `letter-spacing: 0.05em`, weight 700.
- Section/card headers: 11–13px, **uppercase**, `letter-spacing: 0.16–0.22em`.
- Body: 13–14px, `line-height: 1.45`. Hints/footnotes: 11–12px in `--faint`.
- Kickers/labels: 10–12px uppercase, `letter-spacing: 0.1–0.22em`, `--faint`.
- Sentence case is for body prose only; anything that labels UI is uppercase + letterspaced.

## Component recipes

- **Card**: `border: 3px solid var(--ink)`, no radius, no shadow; header row is an uppercase
  letterspaced strip with `border-bottom: 3px solid var(--ink)`; body padding 12–14px.
- **Primary button**: ink background, paper text, `border: 3px solid var(--ink)`, uppercase
  700, 11–12px; hover → red background+border; disabled → `opacity: .45`.
- **Ghost button**: paper background, `border: 2px solid var(--grey)`, hover border ink.
- **Chip** (selection targets, flags): `border: 1.5px solid var(--red)`, red text, uppercase
  10–10.5px, no fill. Neutral chips use ink or grey borders, same shape.
- **Tabs / version pills**: 2px borders, active = ink fill + paper text; pills join with
  negative margin, no radius.
- **Banner**: `border-left: 4px solid` (ink=info, red=error, amber=busy) on `--grey-2`.
- **Tables**: 1px grey row rules, 2px ink under the header row; headers uppercase 10.5–11px.
- **Diff/register**: mono 12px; additions on `--green-bg`, removals on `--red-bg`; hunk
  headers in `--faint`; author chips (HUMAN ink / AGENT red) right-aligned in the header.
- **Sidebar (app shell)**: ink background, paper text, 3px red left-rule on the active item;
  section labels 9.5–10px uppercase in `#8b8b93`.
- **Forms**: labels 11px uppercase letterspaced; inputs `border: 2px solid var(--ink)`,
  no radius, paper background.

## Canvas rules — LOCKED (identical across any future restyle)

- Walls: ink fill; exterior thicker than interior (`EXTERIOR_HALF`/`INTERIOR_HALF` in
  `geometry.ts`). Fixtures: 2px ink outline, no fill. Canvas background is always paper.
- Selection: red — dashed rect overlay for rooms/fixtures, 9px red stroke + white-filled
  red-ringed drag handles for wall chunks.
- Delta view: green solid = added, red dashed = removed, amber dotted = modified. Never
  reuse these three for anything else on the canvas.
- Room labels: uppercase name + mono dims in `--faint`, **always visible on every room** — never
  auto-hidden; shrink to a legible floor on small rooms instead of dropping the dims.

## Do / don't

- **Do** keep accent meanings fixed: red = selection/negative, green = positive; if everything is
  highlighted, nothing is. Rent deltas are green when positive, red when negative — no exceptions.
- **Do** put every number (rent, dims, versions, t-values) in `--mono`.
- **Don't** add shadows, border-radius, gradients, or opacity-tinted brand colours.
- **Don't** add a new colour without adding a token to `styles.css` first and a row here.
- **Don't** restyle canvas semantics (ink walls / red selection / green-red-amber delta).
- **Don't** use icon fonts or emoji in chrome; glyphs like `⤓` and `·` separators are fine.
