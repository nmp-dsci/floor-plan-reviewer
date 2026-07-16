# Floor-Plan Studio — demo walkthroughs

> **Note — recorded artifacts predate the Agent SDK migration.** The committed videos and their
> sidecars (`.mp4` / `.srt` / `.webm`), and the recorder scripts that narrate them, still say
> **DeepSeek / Pydantic AI**. The app has since moved all LLM calls (ops, comps, vision) to the
> **Claude Agent SDK** (running on the operator's Claude subscription via `CLAUDE_CODE_OAUTH_TOKEN`).
> Read the "DeepSeek AGENT" / "Pydantic AI on DeepSeek" mentions below as historical; the loop they
> show is unchanged, only the LLM backend differs. The videos/SRT and scripts are intentionally left
> as-is (re-recording is a separate task).
>
> **Also predate the Drafting Ink 2.0 restyle (2026-07-16).** All three videos show the pre-restyle
> review page (stacked Inspector/Ask-the-Agent/Register/Rent cards, no zoom/fit controls). The
> current review page is a canvas-first workspace with a tabbed dock (EDIT/AGENT/HISTORY/RENT) and
> a bottom version/lens strip — same underlying loop, different layout. See AGENTS.md "Studio app
> UI" for what changed.

Three narrated videos, each a real unedited Playwright session against the local compose stack
(`make -C app up`). **Narration is spoken** (Deepgram Aura TTS, Australian voice
`aura-2-hyperion-en`) *and* burned in as the caption bar — one compact line per scene, timed to
hold while its line plays; a matching `.srt` sidecar and a silent `.webm` cut sit beside each
`.mp4`. Without a `DEEPGRAM_API_KEY` the recordings still run captions-only.

| Video | Make target | What it shows |
|---|---|---|
| `artifacts/whats_new.mp4` (~85s) | `make -C app demo-whats-new` | The P1–P5 upgrade: left-nav shell + address history, the compact context bar with the rent story, always-visible room dims, and the headline change — humans editing geometry directly through the same validated op pipeline, landing a **HUMAN**-authored version with no LLM round-trip. |
| `artifacts/product_tour.mp4` (~108s) | `make -C app demo-tour` | The full updated loop end to end: library → review → delta → a direct **HUMAN** edit (store → study, instant) → a live **DeepSeek AGENT** round-trip (servery window + island bench) → the change register where human and agent hunks interleave. |
| `artifacts/walkthrough.mp4` | `make -C app demo` | The original P0–P5 walkthrough (pre-shared-editing UI), kept for reference. |

`make -C app demo-videos` records both new videos back to back, reseeding the stack before each so
the store→study human edit always starts clean. Both new scripts share `demo/narration.py` (TTS +
caption bar + SRT + audio mix). The section below documents the original walkthrough scene by scene.

---

## Original walkthrough — scene by scene

**Video:** `artifacts/walkthrough.mp4` — a real, unedited session recorded with Playwright
against the local compose stack (`make -C app up`), including a live agent round-trip.
**The narration is spoken** (Deepgram Aura text-to-speech, Australian voice
`aura-2-hyperion-en`) *and* burned in as the caption bar — one compact line per scene, timed so
each scene holds while its line plays. `artifacts/walkthrough.srt` carries the same lines with
measured timestamps; `artifacts/walkthrough.webm` is the silent cut. Without a
`DEEPGRAM_API_KEY`, `make -C app demo` still works and produces the captions-only video.
Stills referenced below are in `artifacts/`.

**The one-liner:** load a property's floor plan as an interactive *shape object*, select the rooms
and wall chunks you want changed, comment, and send — an AI agent edits the geometry through
typed, validated operations and hands back a new version with a computed visual diff, a git-style
change register, rent impact, and NSW advisory flags. The external envelope can never grow: the
validator rejects any edit that breaks it.

## Scene by scene

1. **Library** (`01-library.png`) — the seeded property: 231 Peats Ferry Road, Hornsby, already at
   v03 / $1,260 per week. The upload panel on the right takes any listing floor-plan image and
   routes it through Claude vision ingestion (P4).

2. **Review — proposed v03** (`02-review-proposed-v03.png`) — the plan rendered from geometry as
   SVG: every room and wall is a DOM node. Header chips carry the rent story: $900 baseline →
   v01 $1,000 → v02 $1,040 → v03 $1,260 (+$360 per week cumulative).

3. **Delta vs original** (`03-delta-vs-original.png`) — a computed diff, not a drawing: the
   original 3-bed/1-bath layout against the proposed 5-bed/3-bath. Removed rooms are red dashed
   ghosts (garage, lounge, balcony…), added rooms green (Bed 4, Bed 5, ensuites, robes…), renames
   amber.

4. **Version history** (`04-original-v00.png`) — every version is immutable; v00 shows the
   original plan. The change register on the right accumulates one git-style hunk per change,
   each with its `+`/`-` object lines, rent impact, and compliance flags.

5. **Multi-select** (`05-multi-selection.png`) — click the STORE room, then shift-click (or
   long-press) the wall between the living area and kitchen. The wall selection carries drag
   handles to trim to a *chunk* — the exact stretch where a door or window should go.

6. **Comment → change list** (`06-change-queued.png`) — one comment covering both targets:
   *"Convert the store into a home office called STUDY… and open a servery window in the selected
   section of this wall."* Comments queue locally; nothing sends until you press Send.

7. **Send to agent** (`07-agent-working.png`) — the batch goes to the plan-agent service
   (Pydantic AI on DeepSeek, per spec decision D5). The agent replies with typed operations
   (`set_kind`, `add_opening`…) that plan-core applies and validates — invalid edits bounce back
   to the agent, never into the plan.

8. **v04 arrives** (`08-v04-ready.png`, `09-v04-delta.png`) — pushed over SSE: new version chip,
   updated rent, the study relabelled and the servery window cut into the wall, all visible in
   the delta view.

9. **Register** (`10-register.png`) — the new hunk joins the history; every line traces to a
   geometry object. Exports: the styled PNG of any version and SUMMARY.md, both one click away.

## What this demonstrates (spec phases)

| Phase | Shown by |
|---|---|
| P0 scaffold + library | Scene 1 — compose stack, seeded property |
| P1 walls, chunks, multi-select | Scene 5 |
| P2 diff engine + register | Scenes 3, 4, 9 |
| P3 live agent loop (DeepSeek) | Scenes 7–8 |
| P4 vision ingestion | Library upload panel; verified separately (16 rooms extracted from the listing PNG in ~19s, validator gating the human approve step) |
| P5 comps + exports + summary | Rent-evidence card, PNG/SUMMARY links |

*Concept proposals — not architectural, planning, or financial advice.*
