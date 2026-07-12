"""Record the "what's new" walkthrough — the P1-P5 upgrade in ~50s.

Focuses on everything that changed: the left-nav shell with address history, the
compact context bar with the rent story, always-visible room dimensions, and the
headline feature — humans now edit geometry directly through the same validated op
pipeline the agent uses, landing a HUMAN-authored version with no LLM round-trip.

    artifacts/whats_new.mp4    video + Deepgram Aura voice-over (en-AU)
    artifacts/whats_new.webm   silent video
    artifacts/whats_new.srt    narration with measured timestamps

Assumes a freshly seeded stack (head = v03, the STORE room still present).
"""

from __future__ import annotations

from pathlib import Path

from narration import Narrator, take_webm
from playwright.sync_api import expect, sync_playwright

BASE = "http://localhost:5175"
ART = Path(__file__).parent / "artifacts"

VOICEOVER = {
    "nav": "Floor-Plan Studio has a new home. A left navigation rail carries your "
    "review history — every property, its configuration, and the weekly-rent uplift, "
    "in green.",
    "open": "Open a review and the header is now a single compact bar. The money story "
    "stays in view: nine hundred a week baseline, twelve-sixty proposed, plus three-sixty.",
    "dims": "Every room now shows its dimensions, always — no more guessing the size of a space.",
    "select": "Here's the headline change. Click any room and it opens in the inspector — "
    "name, kind, fill, and exact metres.",
    "edit": "Rename the store to a study and make it habitable. The edit previews on the "
    "plan in amber, and batches until you apply.",
    "apply": "Apply. It lands in under a second — no agent, no waiting. The building "
    "envelope is still validated on every edit.",
    "author": "And the change register now tags every version: this one is marked HUMAN, "
    "the agent's edits are marked AGENT. One plan, two authors.",
    "fixture": "Thin-line joinery is first-class too. Benches and cabinetry are now "
    "selectable objects you can rename, move, or resize.",
    "wrap": "Navigation, direct editing, shared authorship. Humans and the agent now edit "
    "the same canvas.",
}


def main() -> None:
    ART.mkdir(exist_ok=True)
    for stale in ART.glob("whats_new.webm"):
        stale.unlink()
    narr = Narrator(ART, VOICEOVER)
    narr.synthesize()

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(ART),
            record_video_size={"width": 1440, "height": 900},
        )
        page = ctx.new_page()
        narr.start()

        print("1. nav shell / library")
        page.goto(BASE)
        expect(page.locator(".sidebar .addr").first).to_be_visible(timeout=20000)
        narr.caption(page, "nav")
        narr.scene(page, "nav", 4200)

        print("2. open review — context bar")
        page.locator(".sidebar .addr").first.click()
        expect(page.locator(".ctxbar .addr")).to_be_visible(timeout=20000)
        expect(page.locator('[data-room="store"]')).to_be_attached(timeout=8000)
        narr.caption(page, "open")
        narr.scene(page, "open", 4600)

        print("3. always-on dimensions")
        narr.caption(page, "dims")
        narr.scene(page, "dims", 3400)

        print("4. select the store room")
        narr.caption(page, "select")
        page.locator('[data-room="store"]').click()
        expect(page.locator(".inspector-pane")).to_be_visible(timeout=8000)
        narr.scene(page, "select", 3600)

        print("5. rename → STUDY + habitable, queue")
        narr.caption(page, "edit")
        name = page.locator(".frow.one input").first
        name.click()
        name.fill("STUDY")
        page.locator(".inspector-pane select").nth(1).select_option("white")  # fill → white
        page.get_by_role("button", name="Queue edit").click()
        expect(page.locator(".pendinglist li")).to_have_count(1, timeout=5000)
        narr.scene(page, "edit", 3400)

        print("6. apply → HUMAN v04")
        narr.caption(page, "apply")
        page.get_by_role("button", name="Apply", exact=False).click()
        expect(page.get_by_role("button", name="v04", exact=True)).to_be_visible(timeout=20000)
        narr.scene(page, "apply", 3600)

        print("7. author chip in the register")
        narr.caption(page, "author")
        page.locator("pre.diff").first.scroll_into_view_if_needed()
        expect(page.locator(".authtag.human").first).to_be_visible(timeout=8000)
        narr.scene(page, "author", 4200)

        print("8. fixtures are first-class")
        narr.caption(page, "fixture")
        page.mouse.wheel(0, -1200)
        page.locator("[data-fixture]").first.click(force=True)
        page.wait_for_timeout(400)
        narr.scene(page, "fixture", 3800)

        print("9. wrap")
        narr.caption(page, "wrap")
        narr.scene(page, "wrap", 3200)

        ctx.close()  # flush video
        webm = take_webm(ART, "whats_new")
        browser.close()

    narr.finish(webm, "whats_new")
    print("done")


if __name__ == "__main__":
    main()
