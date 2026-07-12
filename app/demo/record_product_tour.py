"""Record the full updated product tour (~75s), end to end.

Runs the whole Floor-Plan Studio loop on the new UI: the nav shell and library, a
review with the compact context bar, the delta diff, a direct HUMAN edit that lands
instantly, then a live DeepSeek AGENT round-trip that returns typed, validated
geometry — closing on the change register where human and agent hunks interleave.

    artifacts/product_tour.mp4    video + Deepgram Aura voice-over (en-AU)
    artifacts/product_tour.webm   silent video
    artifacts/product_tour.srt    narration with measured timestamps

Assumes a freshly seeded stack (head = v03, STORE room present) and a live agent.
"""

from __future__ import annotations

from pathlib import Path

from narration import Narrator, take_webm
from playwright.sync_api import expect, sync_playwright

BASE = "http://localhost:5175"
ART = Path(__file__).parent / "artifacts"
COMMENT = (
    "Open a servery window in this wall between the living area and the kitchen, "
    "and add an island bench in the kitchen."
)

VOICEOVER = {
    "library": "Floor-Plan Studio. The library lists every property; the rail on the left "
    "is your review history, with the rent uplift for each.",
    "open": "Open the seeded property. The context bar keeps the numbers in view — nine "
    "hundred a week today, twelve-sixty proposed.",
    "canvas": "The plan is a live shape object, not a picture. Every room, wall, opening, "
    "and fixture is a real thing you can select — and every room shows its dimensions.",
    "delta": "Delta view is a computed geometry diff against the original. Green added, "
    "red removed, amber modified.",
    "human": "You can edit directly. Rename the store to a study, make it habitable, and "
    "apply — it lands in under a second, validated, with no agent.",
    "aselect": "Or hand a change to the agent. Select the wall between the living area and "
    "the kitchen.",
    "aqueue": "Describe the change in plain English: a servery window, and an island bench. "
    "Comments queue locally.",
    "asend": "Send. The DeepSeek agent replies with typed geometry operations — never "
    "pixels — and the envelope can never grow.",
    "aready": "The new version arrives live, with the servery window, the bench, and a "
    "fresh rent estimate.",
    "register": "The change register interleaves both authors — HUMAN and AGENT — and every "
    "line traces back to a geometry object. Export any version as a plan or a summary.",
    "wrap": "Select, edit or ask, done. One canvas, shared by you and the agent.",
}


def main() -> None:
    ART.mkdir(exist_ok=True)
    for stale in ART.glob("product_tour.webm"):
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

        print("1. library")
        page.goto(BASE)
        expect(page.locator(".sidebar .addr").first).to_be_visible(timeout=20000)
        narr.caption(page, "library")
        narr.scene(page, "library", 4200)

        print("2. open review")
        page.locator(".sidebar .addr").first.click()
        expect(page.locator(".ctxbar .addr")).to_be_visible(timeout=20000)
        expect(page.locator('[data-room="store"]')).to_be_attached(timeout=8000)
        narr.caption(page, "open")
        narr.scene(page, "open", 4200)

        print("3. canvas")
        narr.caption(page, "canvas")
        narr.scene(page, "canvas", 4400)

        print("4. delta vs original")
        page.get_by_role("button", name="Delta", exact=True).click()
        narr.caption(page, "delta")
        narr.scene(page, "delta", 4000)
        page.get_by_role("button", name="Proposed", exact=True).click()
        page.wait_for_timeout(600)

        print("5. human edit → v04")
        narr.caption(page, "human")
        page.locator('[data-room="store"]').click()
        expect(page.locator(".inspector-pane")).to_be_visible(timeout=8000)
        name = page.locator(".frow.one input").first
        name.click()
        name.fill("STUDY")
        page.locator(".inspector-pane select").nth(1).select_option("white")
        page.get_by_role("button", name="Queue edit").click()
        page.get_by_role("button", name="Apply", exact=False).click()
        expect(page.get_by_role("button", name="v04", exact=True)).to_be_visible(timeout=20000)
        narr.scene(page, "human", 3600)

        print("6. agent: select the wall")
        narr.caption(page, "aselect")
        page.locator('[data-wall="w:kitchen-dining|living:0"]').click(force=True)
        expect(page.locator(".comment-panel textarea")).to_be_visible(timeout=8000)
        narr.scene(page, "aselect", 3200)

        print("7. queue the comment")
        narr.caption(page, "aqueue")
        page.locator(".comment-panel textarea").fill(COMMENT)
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Add to change list").click()
        narr.scene(page, "aqueue", 3000)

        print("8. send to agent (live DeepSeek round-trip)")
        pills = page.locator(".subbar .versions button").count()
        page.get_by_role("button", name="Send", exact=False).click()
        narr.caption(page, "asend")
        expect(page.get_by_text("Agent", exact=False).first).to_be_visible(timeout=10000)
        narr.scene(page, "asend", 2000)
        expect(page.locator(".subbar .versions button")).to_have_count(pills + 1, timeout=240000)
        narr.caption(page, "aready")
        page.wait_for_timeout(800)
        page.get_by_role("button", name="Delta", exact=True).click()
        narr.scene(page, "aready", 3600)

        print("9. register — human + agent")
        page.get_by_role("button", name="Proposed", exact=True).click()
        narr.caption(page, "register")
        page.locator("pre.diff").first.scroll_into_view_if_needed()
        expect(page.locator(".authtag.human").first).to_be_visible(timeout=8000)
        narr.scene(page, "register", 4600)

        print("10. wrap")
        page.mouse.wheel(0, -2400)
        narr.caption(page, "wrap")
        narr.scene(page, "wrap", 3200)

        ctx.close()  # flush video
        webm = take_webm(ART, "product_tour")
        browser.close()

    narr.finish(webm, "product_tour")
    print("done")


if __name__ == "__main__":
    main()
