"""Record the Floor-Plan Studio walkthrough video against the running compose stack.

Drives a real browser through the 231 Peats Ferry Rd review — library, proposed
plan, delta view, git-style register, room + wall-chunk multi-select, a live
agent round-trip producing a new version — and saves walkthrough.webm/.mp4 plus
stills into demo/artifacts/. This doubles as the end-to-end verification of
P0–P3+P5.

Narration: each scene shows a caption bar (subtitle-length condensations of
DEMO.md) injected into the page, so the explanation is burned into every frame.
A walkthrough.srt sidecar with the real measured timings is written alongside.
"""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = "http://localhost:5175"
ART = Path(__file__).parent / "artifacts"
COMMENT = (
    "Convert the store into a home office called STUDY (habitable, white fill), "
    "and open a servery window in the selected section of this wall between the "
    "living area and the kitchen."
)

CAPTIONS = {
    "library": "FLOOR-PLAN STUDIO — the plan library. 231 Peats Ferry Rd is seeded at v03, "
    "$1,260/wk. Any listing floor-plan image can be uploaded for AI vision ingestion.",
    "review": "The review. The plan is a live SVG shape object — every room and wall is a "
    "selectable node. Header chips carry the rent story: $900 baseline → $1,260/wk (+$360).",
    "delta": "DELTA VS ORIGINAL — a computed geometry diff, not a drawing: red dashed = removed "
    "(garage, lounge, balcony), green = added (Bed 4, Bed 5, ensuites, robes), amber = modified.",
    "v00": "Versions are immutable. v00 is the original 3-bed/1-bath plan. On the right: the "
    "change register — one git-style hunk per change, with rent impact and NSW advisory flags.",
    "select": "Selecting the STORE room, then shift-clicking the wall between living and kitchen. "
    "The red handles can trim a wall selection to the exact chunk where a window should go.",
    "queue": "One comment covers both targets: store becomes a STUDY + a servery window in the "
    "selected wall section. Comments queue locally — nothing sends until you press send.",
    "send": "Sent to the agent (Pydantic AI on DeepSeek). It answers with TYPED GEOMETRY OPS — "
    "validated before they land. The building envelope can never grow; bad edits bounce back.",
    "v04": "The new version arrives over SSE: the store is now a STUDY with a servery window, and "
    "the agent re-estimated the weekly rent live — the header chips update in place.",
    "register": "The new hunk joins the register — every +/− line traces to a geometry object, "
    "with NSW advisory flags. Any version exports as a styled PNG or SUMMARY.md.",
    "wrap": "Select → comment → send. The agent edits geometry, never pixels. "
    "github.com/nmp-dsci/floor-plan-reviewer",
}

_subs: list[tuple[float, str]] = []
_t0 = 0.0


def caption(page: Page, key: str) -> None:
    text = CAPTIONS[key]
    _subs.append((time.monotonic() - _t0, text))
    page.evaluate(
        """(text) => {
          let bar = document.getElementById('demo-caption');
          if (!bar) {
            bar = document.createElement('div');
            bar.id = 'demo-caption';
            Object.assign(bar.style, {
              position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '99999',
              background: 'rgba(20,20,22,0.93)', color: '#fff',
              font: '600 16.5px/1.45 "Helvetica Neue", Arial, sans-serif',
              padding: '13px 30px', textAlign: 'center',
              borderTop: '3px solid #e23d28', pointerEvents: 'none',
            });
            document.body.appendChild(bar);
          }
          bar.textContent = text;
        }""",
        text,
    )


def _srt_time(s: float) -> str:
    ms = int(round(s * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(total: float) -> Path:
    out = ART / "walkthrough.srt"
    blocks = []
    for i, (start, text) in enumerate(_subs):
        end = _subs[i + 1][0] if i + 1 < len(_subs) else total
        blocks.append(f"{i + 1}\n{_srt_time(start)} --> {_srt_time(end)}\n{text}\n")
    out.write_text("\n".join(blocks))
    return out


def pause(page: Page, ms: int) -> None:
    page.wait_for_timeout(ms)


def shot(page: Page, name: str) -> None:
    page.screenshot(path=ART / f"{name}.png")
    print(f"  📸 {name}")


def main() -> None:
    global _t0
    ART.mkdir(exist_ok=True)
    for stale in ART.glob("*.webm"):
        stale.unlink()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(ART),
            record_video_size={"width": 1440, "height": 900},
        )
        page = ctx.new_page()
        _t0 = time.monotonic()

        print("1. library")
        page.goto(BASE)
        expect(page.get_by_text("231 Peats Ferry Road, Hornsby")).to_be_visible(timeout=20000)
        caption(page, "library")
        pause(page, 4200)
        shot(page, "01-library")

        print("2. open review — proposed v03")
        page.get_by_text("231 Peats Ferry Road, Hornsby").click()
        expect(page.locator("svg rect.room-hit").first).to_be_visible(timeout=20000)
        caption(page, "review")
        pause(page, 4800)
        shot(page, "02-review-proposed-v03")

        print("3. delta vs original")
        page.get_by_role("button", name="Delta vs original").click()
        caption(page, "delta")
        pause(page, 5200)
        shot(page, "03-delta-vs-original")

        print("4. version history — flip back to v00 then head")
        page.get_by_role("button", name="v00", exact=True).click()
        caption(page, "v00")
        pause(page, 4600)
        shot(page, "04-original-v00")
        page.get_by_role("button", name="v03", exact=True).click()
        page.get_by_role("button", name="Proposed").click()
        pause(page, 1200)

        print("5. select STORE room + wall chunk (multi-select)")
        caption(page, "select")
        page.locator('[data-room="store"]').click()
        pause(page, 1600)
        # force: zero-height SVG lines fail Playwright's visibility heuristic but are clickable
        page.locator('[data-wall="w:kitchen-dining|living:0"]').click(
            modifiers=["Shift"], force=True
        )
        pause(page, 2600)
        shot(page, "05-multi-selection")

        print("6. queue the comment")
        caption(page, "queue")
        page.locator(".comment-panel textarea").fill(COMMENT)
        pause(page, 2000)
        page.get_by_role("button", name="Add to change list").click()
        pause(page, 2600)
        shot(page, "06-change-queued")

        print("7. send to agent (live DeepSeek round-trip)")
        page.get_by_role("button", name="Send", exact=False).click()
        caption(page, "send")
        expect(page.get_by_text("Agent", exact=False).first).to_be_visible(timeout=10000)
        pause(page, 1500)
        shot(page, "07-agent-working")
        expect(page.get_by_role("button", name="v04", exact=True)).to_be_visible(timeout=240000)
        caption(page, "v04")
        pause(page, 4200)
        shot(page, "08-v04-ready")

        print("8. v04 delta + register")
        page.get_by_role("button", name="Delta vs original").click()
        pause(page, 3000)
        shot(page, "09-v04-delta")
        caption(page, "register")
        register = page.locator("pre.diff").first
        register.scroll_into_view_if_needed()
        pause(page, 4200)
        shot(page, "10-register")

        print("9. wrap on the stats bar")
        page.mouse.wheel(0, -2000)
        caption(page, "wrap")
        pause(page, 4000)

        total = time.monotonic() - _t0
        ctx.close()  # flushes the video
        video_files = sorted(ART.glob("*.webm"), key=lambda p: p.stat().st_mtime)
        raw = video_files[-1]
        final_webm = ART / "walkthrough.webm"
        shutil.move(raw, final_webm)
        browser.close()

    srt = write_srt(total)
    print(f"subtitles: {srt}")
    print(f"video: {final_webm} ({final_webm.stat().st_size // 1024} KB)")
    if shutil.which("ffmpeg"):
        mp4 = ART / "walkthrough.mp4"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(final_webm), str(mp4)],
            check=True,
        )
        print(f"video: {mp4} ({mp4.stat().st_size // 1024} KB)")
    print("done in", time.strftime("%H:%M:%S"))


if __name__ == "__main__":
    main()
