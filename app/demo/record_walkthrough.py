"""Record the Floor-Plan Studio walkthrough video against the running compose stack.

Drives a real browser through the 231 Peats Ferry Rd review — library, proposed
plan, delta view, git-style register, room + wall-chunk multi-select, a live
agent round-trip producing v04 — and saves walkthrough.webm/.mp4 plus stills
into demo/artifacts/. This doubles as the end-to-end verification of P0–P3+P5.
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


def pause(page: Page, ms: int) -> None:
    page.wait_for_timeout(ms)


def shot(page: Page, name: str) -> None:
    page.screenshot(path=ART / f"{name}.png")
    print(f"  📸 {name}")


def main() -> None:
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

        print("1. library")
        page.goto(BASE)
        expect(page.get_by_text("231 Peats Ferry Road, Hornsby")).to_be_visible(timeout=20000)
        pause(page, 2500)
        shot(page, "01-library")

        print("2. open review — proposed v03")
        page.get_by_text("231 Peats Ferry Road, Hornsby").click()
        expect(page.locator("svg rect.room-hit").first).to_be_visible(timeout=20000)
        pause(page, 3000)
        shot(page, "02-review-proposed-v03")

        print("3. delta vs original")
        page.get_by_role("button", name="Delta vs original").click()
        pause(page, 4000)
        shot(page, "03-delta-vs-original")

        print("4. version history — flip back to v00 then head")
        page.get_by_role("button", name="v00", exact=True).click()
        pause(page, 2200)
        shot(page, "04-original-v00")
        page.get_by_role("button", name="v03", exact=True).click()
        page.get_by_role("button", name="Proposed").click()
        pause(page, 1500)

        print("5. select STORE room + wall chunk (multi-select)")
        page.locator('[data-room="store"]').click()
        pause(page, 1200)
        # force: zero-height SVG lines fail Playwright's visibility heuristic but are clickable
        page.locator('[data-wall="w:kitchen-dining|living:0"]').click(
            modifiers=["Shift"], force=True
        )
        pause(page, 1500)
        shot(page, "05-multi-selection")

        print("6. queue the comment")
        page.locator(".comment-panel textarea").fill(COMMENT)
        pause(page, 1200)
        page.get_by_role("button", name="Add to change list").click()
        pause(page, 1800)
        shot(page, "06-change-queued")

        print("7. send to agent (live DeepSeek round-trip)")
        page.get_by_role("button", name="Send", exact=False).click()
        expect(page.get_by_text("Agent", exact=False).first).to_be_visible(timeout=10000)
        pause(page, 1500)
        shot(page, "07-agent-working")
        expect(page.get_by_role("button", name="v04", exact=True)).to_be_visible(timeout=240000)
        pause(page, 2500)
        shot(page, "08-v04-ready")

        print("8. v04 delta + register")
        page.get_by_role("button", name="Delta vs original").click()
        pause(page, 3500)
        shot(page, "09-v04-delta")
        register = page.locator("pre.diff").first
        register.scroll_into_view_if_needed()
        pause(page, 3000)
        shot(page, "10-register")

        print("9. wrap on the stats bar")
        page.mouse.wheel(0, -2000)
        pause(page, 3000)

        ctx.close()  # flushes the video
        video_files = sorted(ART.glob("*.webm"), key=lambda p: p.stat().st_mtime)
        raw = video_files[-1]
        final_webm = ART / "walkthrough.webm"
        shutil.move(raw, final_webm)
        browser.close()

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
