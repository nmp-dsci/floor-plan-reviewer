"""Playwright e2e gesture matrix — the browser-level half of the Feature Checks.

The in-app Feature Checks tab proves op semantics through /edits; this script
proves the GESTURES: real clicks, drags, draws and keyboard shortcuts against the
running compose stack, on a throwaway sandbox review (created and deleted via the
same admin API the tab uses — your data is never touched).

    artifacts/feature_matrix_report.json   machine-readable results
    artifacts/feature_matrix_report.md     human-readable PASS/FAIL table

Run: make -C app e2e
"""

from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = "http://localhost:5175"
API = "http://localhost:8090"
ART = Path(__file__).parent / "artifacts"

RESULTS: list[dict[str, str | float]] = []


def record(feature: str, fn) -> None:
    t0 = time.monotonic()
    try:
        fn()
        RESULTS.append(
            {"feature": feature, "status": "PASS", "seconds": round(time.monotonic() - t0, 2)}
        )
        print(f"  ✓ {feature}")
    except Exception as exc:  # noqa: BLE001 — report, don't abort the matrix
        RESULTS.append(
            {
                "feature": feature,
                "status": "FAIL",
                "seconds": round(time.monotonic() - t0, 2),
                "error": str(exc)[:300],
            }
        )
        print(f"  ✗ {feature}: {str(exc)[:120]}")


def api_json(method: str, path: str):
    req = urllib.request.Request(f"{API}{path}", method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def pending_count(page: Page) -> int:
    return page.locator(".pendinglist li").count()


def pending_texts(page: Page) -> list[str]:
    return [t.strip() for t in page.locator(".pendinglist li").all_inner_texts()]


def discard(page: Page) -> None:
    if pending_count(page):
        page.get_by_role("button", name="Discard").click()
        page.wait_for_timeout(200)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)


def select_room(page: Page, room_id: str) -> None:
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    page.locator(f'[data-room="{room_id}"]').click(force=True)
    page.wait_for_timeout(250)


def blur_inputs(page: Page) -> None:
    """Q4 autofocus puts focus in the Name/Label field; object-level shortcuts
    (⌘C/⌘V/Delete) apply once focus leaves the field — like a user pressing Tab."""
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.wait_for_timeout(100)


def main() -> None:
    ART.mkdir(exist_ok=True)
    sb = api_json("POST", "/api/admin/sandbox")
    review_id = sb["review_id"]
    print(f"sandbox review: {review_id}")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
            # the first-run coach modal would block gestures; a real user sees it once
            page.add_init_script(
                "try{window.localStorage.setItem('fps-coach-dismissed','1')}catch(e){}"
            )
            page.goto(f"{BASE}/#/review/{review_id}")
            expect(page.locator(".ctxbar .addr")).to_be_visible(timeout=20000)
            page.wait_for_timeout(600)

            geo = api_json("GET", f"/api/reviews/{review_id}/versions/0")["geometry"]
            rooms = [r for r in geo["rooms"] if r["z"] == 0 and r["w"] > 2 and r["h"] > 2]
            room = rooms[0]
            rid = room["id"]

            # 1. select room → inspector opens with name focused (Q4 autofocus)
            def t_select():
                select_room(page, rid)
                expect(page.locator(".inspector-pane .what")).to_be_visible(timeout=4000)
                focused = page.evaluate("document.activeElement?.tagName")
                assert focused == "INPUT", f"name field not focused (focus on {focused})"

            record("select room → rename field auto-focused", t_select)

            # 2. rename via keyboard (type + Enter)
            def t_rename():
                page.keyboard.type("E2E ROOM")
                page.keyboard.press("Enter")
                page.wait_for_timeout(250)
                assert any("E2E ROOM" in t for t in pending_texts(page)), pending_texts(page)
                discard(page)

            record("rename room (type + Enter)", t_rename)

            # 3. drag-move the room (selection overlay drag)
            def t_drag_move():
                select_room(page, rid)
                sel = page.locator(
                    '.canvas-wrap rect[stroke="#e23d28"][stroke-dasharray="7 4"]'
                ).first
                box = sel.bounding_box()
                assert box, "no selection overlay"
                cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                page.mouse.move(cx, cy)
                page.mouse.down()
                page.mouse.move(cx + 30, cy, steps=4)
                page.mouse.up()
                page.wait_for_timeout(250)
                assert any("resize" in t for t in pending_texts(page)), pending_texts(page)
                discard(page)

            record("drag room to move", t_drag_move)

            # 4. corner-handle resize
            def t_resize():
                select_room(page, rid)
                handle = page.locator('.canvas-wrap circle[stroke="#e23d28"]').last
                box = handle.bounding_box()
                assert box, "no resize handle"
                cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                page.mouse.move(cx, cy)
                page.mouse.down()
                page.mouse.move(cx - 25, cy - 25, steps=4)
                page.mouse.up()
                page.wait_for_timeout(250)
                assert any("resize" in t for t in pending_texts(page)), pending_texts(page)
                discard(page)

            record("corner-handle resize", t_resize)

            # 5. wall move drag (interior wall, perpendicular) — prefer a wall with
            # no openings and click near its END so a centre door can't steal the click
            def t_wall_move():
                def ok_rooms(w):
                    return any(
                        r["id"] == w["a"] and r["z"] == 0 and r["w"] > 1.2 and r["h"] > 1.2
                        for r in geo["rooms"]
                    ) and any(
                        r["id"] == w["b"] and r["z"] == 0 and r["w"] > 1.2 and r["h"] > 1.2
                        for r in geo["rooms"]
                    )

                candidates = [w for w in geo["walls"] if w["b"] != "exterior" and ok_rooms(w)]
                interior = next((w for w in candidates if not w["openings"]), candidates[0])
                page.keyboard.press("Escape")
                el = page.locator(f'[data-wall="{interior["id"]}"]')
                bb = el.bounding_box()
                assert bb, "wall hit line has no box"
                vert = abs(interior["line"][0] - interior["line"][2]) < 1e-9
                # click 12% along the wall (ends are solid even when a door sits mid-wall)
                pos = (
                    {"x": max(bb["width"] / 2, 1), "y": max(bb["height"] * 0.12, 2)}
                    if vert
                    else {"x": max(bb["width"] * 0.12, 2), "y": max(bb["height"] / 2, 1)}
                )
                el.click(force=True, position=pos)
                page.wait_for_timeout(300)
                blur_inputs(page)
                grab = page.locator(
                    '.canvas-wrap line[stroke="transparent"][stroke-width="18"]'
                ).first
                box = grab.bounding_box()
                assert box, "no wall-move grab line"
                cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                page.mouse.move(cx, cy)
                page.mouse.down()
                page.mouse.move(cx + (18 if vert else 0), cy + (0 if vert else 18), steps=4)
                page.mouse.up()
                page.wait_for_timeout(300)
                texts = pending_texts(page)
                assert sum("resize" in t for t in texts) >= 2, (
                    f"expected two resize ops, got {texts}"
                )
                discard(page)

            record("drag wall sideways (rooms trade space)", t_wall_move)

            # 6. add wall (split) by drawing a line
            def t_add_wall():
                page.get_by_role("button", name="+ Wall").click()
                big = max(rooms, key=lambda r: r["w"] * r["h"])
                bb = page.locator(f'[data-room="{big["id"]}"]').bounding_box()
                assert bb, "no host room"
                y = bb["y"] + bb["height"] * 0.5
                page.mouse.move(bb["x"] + 8, y)
                page.mouse.down()
                page.mouse.move(bb["x"] + bb["width"] - 8, y, steps=5)
                page.mouse.up()
                page.wait_for_timeout(300)
                assert any("add wall" in t for t in pending_texts(page)), pending_texts(page)
                # the new room is auto-selected for naming
                focused = page.evaluate("document.activeElement?.tagName")
                assert focused == "INPUT", "split room not auto-focused for naming"
                discard(page)

            record("add wall (draw line → split)", t_add_wall)

            # 7. draw a fixture → label field auto-focused → type label
            def t_fixture():
                page.get_by_role("button", name="+ Fixture").click()
                big = max(rooms, key=lambda r: r["w"] * r["h"])
                bb = page.locator(f'[data-room="{big["id"]}"]').bounding_box()
                x0, y0 = bb["x"] + 12, bb["y"] + 12
                page.mouse.move(x0, y0)
                page.mouse.down()
                page.mouse.move(x0 + 60, y0 + 30, steps=4)
                page.mouse.up()
                page.wait_for_timeout(350)
                focused = page.evaluate("document.activeElement?.tagName")
                assert focused == "INPUT", "label field not focused after draw"
                page.keyboard.type("E2E BENCH")
                page.keyboard.press("Enter")
                page.wait_for_timeout(250)
                assert any("E2E BENCH" in t for t in pending_texts(page)), pending_texts(page)
                discard(page)

            record("draw fixture → label immediately", t_fixture)

            # 8. duplicate room via ⌘C/⌘V (Control works for metaKey||ctrlKey)
            def t_copy_paste():
                select_room(page, rid)
                blur_inputs(page)  # leave the autofocused name field (Tab/click in real use)
                page.locator("body").press("Control+c")
                page.wait_for_timeout(150)
                page.locator("body").press("Control+v")
                page.wait_for_timeout(300)
                assert any("copy" in t for t in pending_texts(page)), pending_texts(page)
                # the pasted copy is auto-selected and movable: drag it
                sel = page.locator(
                    '.canvas-wrap rect[stroke="#e23d28"][stroke-dasharray="7 4"]'
                ).first
                box = sel.bounding_box()
                assert box, "pasted copy not selected"
                cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                page.mouse.move(cx, cy)
                page.mouse.down()
                page.mouse.move(cx - 25, cy + 10, steps=4)
                page.mouse.up()
                page.wait_for_timeout(250)
                discard(page)

            record("⌘C/⌘V duplicate → copy is movable pre-apply", t_copy_paste)

            # 9. Delete key removes selection
            def t_delete_key():
                select_room(page, rid)
                blur_inputs(page)
                page.locator("body").press("Delete")
                page.wait_for_timeout(250)
                assert any("remove room" in t for t in pending_texts(page)), pending_texts(page)
                discard(page)

            record("Delete key removes selected object", t_delete_key)

            # 10. ⌘Z pops the last pending op
            def t_undo_pending():
                select_room(page, rid)
                page.keyboard.type("XX")
                page.keyboard.press("Enter")
                page.wait_for_timeout(200)
                n0 = pending_count(page)
                assert n0 >= 1
                page.locator("body").press("Control+z")
                page.wait_for_timeout(250)
                assert pending_count(page) == n0 - 1, "ctrl+z did not pop pending"
                discard(page)

            record("Ctrl+Z pops pending edit", t_undo_pending)

            # 11. apply a batch → one version; Ctrl+Z rolls it back
            def t_apply_and_rollback():
                select_room(page, rid)
                page.keyboard.type("E2E FINAL")
                page.keyboard.press("Enter")
                page.wait_for_timeout(200)
                page.get_by_role("button", name="Apply", exact=False).click()
                expect(page.get_by_role("button", name="v01", exact=True)).to_be_visible(
                    timeout=15000
                )
                page.locator("body").press("Control+z")
                page.wait_for_timeout(1500)
                expect(page.get_by_role("button", name="v01", exact=True)).to_have_count(
                    0, timeout=10000
                )

            record("Apply batch → v01, Ctrl+Z rolls back", t_apply_and_rollback)

            # 12. clear dims are on every room label (SVG text → use textContent)
            def t_clear_dims():
                labels = page.eval_on_selector_all(
                    ".canvas-wrap text", "els => els.map(e => e.textContent || '')"
                )
                dims = [t for t in labels if " x " in t and t.endswith("m")]
                assert len(dims) >= len(rooms), (
                    f"only {len(dims)} dims labels for {len(rooms)} big rooms"
                )

            record("clear dims visible on room labels", t_clear_dims)

            browser.close()
    finally:
        try:
            api_json("DELETE", f"/api/admin/sandbox/{review_id}")
            print("sandbox deleted")
        except Exception as exc:  # noqa: BLE001
            print(f"sandbox cleanup left to startup sweep: {exc}")

    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    (ART / "feature_matrix_report.json").write_text(json.dumps(RESULTS, indent=2))
    lines = [
        "# Plan-canvas gesture matrix — e2e report",
        "",
        f"{passed}/{len(RESULTS)} passed · {time.strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "| Feature | Status | s |",
        "|---|---|---|",
    ]
    for r in RESULTS:
        err = f" — {r.get('error', '')}" if r["status"] == "FAIL" else ""
        lines.append(f"| {r['feature']}{err} | {r['status']} | {r['seconds']} |")
    (ART / "feature_matrix_report.md").write_text("\n".join(lines) + "\n")
    print(f"\n{passed}/{len(RESULTS)} passed → {ART / 'feature_matrix_report.md'}")
    if passed < len(RESULTS):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
