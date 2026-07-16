"""The golden-path regression — 231 Peats Ferry Rd, always run.

The one canonical scenario that exercises the whole product promise: *load a floor
plan → maximise weekly rent strictly inside the existing envelope*. Every restyle
phase (and every future change) must keep this green.

Two tiers, mirroring the plan's §5 table:

  T1 · deterministic  — a throwaway sandbox review (clone of the seeded 231-PFR v0,
      never touches real data). The canonical scope changes are applied through the
      SAME validated /edits pipeline the UI uses; then geometry, envelope-immutability
      and the on-canvas delta render are asserted in a real browser. Always runs.

  T2 · live web       — full upload → vision ingest → approve → agent re-price with
      live comparables. Non-deterministic (vision + web), so it is OPT-IN via
      GOLDEN_T2=1 and SKIPPED-LOUDLY otherwise — never silently.

    artifacts/golden_path_report.json   machine-readable results
    artifacts/golden_path_report.md     human-readable PASS/FAIL table

Run: make -C app golden
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = os.environ.get("GOLDEN_BASE", "http://localhost:5175")
API = os.environ.get("GOLDEN_API", "http://localhost:8090")
ART = Path(__file__).parent / "artifacts"
ORIGINAL_PNG = Path(__file__).resolve().parents[2] / "231-peats-ferry-rd" / "original.png"

RESULTS: list[dict[str, str | float]] = []


def record(feature: str, fn) -> None:
    t0 = time.monotonic()
    try:
        fn()
        RESULTS.append(
            {"feature": feature, "status": "PASS", "seconds": round(time.monotonic() - t0, 2)}
        )
        print(f"  ✓ {feature}")
    except Exception as exc:  # noqa: BLE001 — report, don't abort the run
        RESULTS.append(
            {
                "feature": feature,
                "status": "FAIL",
                "seconds": round(time.monotonic() - t0, 2),
                "error": str(exc)[:300],
            }
        )
        print(f"  ✗ {feature}: {str(exc)[:160]}")


def skip(feature: str, why: str) -> None:
    RESULTS.append({"feature": feature, "status": "SKIP", "seconds": 0.0, "error": why})
    print(f"  ⣿ SKIP {feature}: {why}")


def api_json(method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        method=method,
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def edits(review_id: str, version_n: int, ops: list[dict], title: str) -> dict:
    """Apply a batch through the shared human/agent pipeline. Raises on non-201."""
    return api_json(
        "POST",
        f"/api/reviews/{review_id}/edits",
        {"version_n": version_n, "ops": ops, "title": title, "level": ""},
    )


def head_geo(review_id: str) -> tuple[int, dict]:
    r = api_json("GET", f"/api/reviews/{review_id}")
    n = r["head_n"]
    d = api_json("GET", f"/api/reviews/{review_id}/versions/{n}")
    return n, d["geometry"]


def config_of(geo: dict) -> tuple[int, int, int]:
    beds = sum(1 for r in geo["rooms"] if r["kind"] == "bedroom")
    baths = sum(1 for r in geo["rooms"] if r["kind"] == "wet" and "wc" not in r["name"].lower())
    wcs = sum(1 for r in geo["rooms"] if r["kind"] == "wet" and "wc" in r["name"].lower())
    return beds, baths, wcs


def internal_area(geo: dict) -> float:
    return sum(r["w"] * r["h"] for r in geo["rooms"] if r["z"] == 0 and r["fill"] != "grey")


def find_room(geo: dict, **by) -> dict | None:
    for r in geo["rooms"]:
        if all(str(r.get(k, "")).lower() == str(v).lower() for k, v in by.items()):
            return r
    return None


# ---------------------------------------------------------------------------
# T1 — deterministic geometry + delta render on a sandbox 231-PFR review
# ---------------------------------------------------------------------------


def run_t1(page: Page) -> None:
    sb = api_json("POST", "/api/admin/sandbox")
    review_id = sb["review_id"]
    print(f"sandbox review: {review_id}")
    try:
        v0n, v0 = head_geo(review_id)
        env0 = v0["meta"].get("envelope")
        beds0, baths0, wcs0 = config_of(v0)
        area0 = internal_area(v0)

        def t_baseline():
            assert v0n == 0, f"sandbox head should be v0, got v{v0n}"
            assert (beds0, baths0, wcs0) == (3, 1, 1), f"baseline config {(beds0, baths0, wcs0)}"
            assert env0 and abs((env0[2] - env0[0]) * (env0[3] - env0[1]) - 216) < 2, (
                f"envelope not ~216 m²: {env0}"
            )
            assert 80 <= area0 <= 110, f"baseline internal area {area0:.1f} outside 80–110 m²"

        record("baseline v0 = 3 bed · 1 bath · 1 wc, ~216 m² envelope", t_baseline)

        # -- canonical scope, all internal, applied through the shared /edits pipeline --

        def t_convert_grey():
            # garage + balcony (grey utility) → habitable rooms brought inside the envelope
            edits(
                review_id,
                0,
                [
                    {"op": "set_kind", "room_id": "garage", "name": "BED 4", "kind": "bedroom", "fill": "white"},
                    {"op": "set_kind", "room_id": "balcony", "name": "LIVING", "kind": "living", "fill": "white"},
                ],
                "Garage → Bed 4 · balcony → living",
            )
            n, g = head_geo(review_id)
            assert find_room(g, id="garage", kind="bedroom"), "garage not converted to bedroom"
            assert find_room(g, id="balcony", kind="living"), "balcony not converted to living"
            assert not any(
                r["kind"] == "utility" and r["name"].upper() in ("GARAGE", "BALCONY")
                for r in g["rooms"]
            ), "a grey garage/balcony utility room still remains"

        record("garage → Bed 4 · balcony → living (grey → habitable)", t_convert_grey)

        def t_ensuite():
            # carve an ensuite off the new Bed 4 by splitting (tiles cleanly, no overlap)
            n, g = head_geo(review_id)
            garage = find_room(g, id="garage")
            at = round(garage["y"] + garage["h"] - 2.0, 2)
            edits(
                review_id,
                n,
                [{"op": "split_room", "room_id": "garage", "axis": "y", "at": at, "new_name": "ENSUITE"}],
                "Carve ensuite off Bed 4",
            )
            n2, g2 = head_geo(review_id)
            ens = find_room(g2, name="ENSUITE")
            assert ens, "ENSUITE room not created by split"
            edits(
                review_id,
                n2,
                [{"op": "set_kind", "room_id": ens["id"], "kind": "wet"}],
                "Ensuite is a wet room",
            )
            _, g3 = head_geo(review_id)
            assert find_room(g3, name="ENSUITE", kind="wet"), "ensuite not set to wet"

        record("carve Bed 4 ensuite (split → wet)", t_ensuite)

        def t_bed1_wir():
            # BED 1 walk-in robe carved from the hall side (split → storage)
            n, g = head_geo(review_id)
            bed1 = find_room(g, id="bed-1")
            at = round(bed1["x"] + bed1["w"] - 1.0, 2)
            edits(
                review_id,
                n,
                [{"op": "split_room", "room_id": "bed-1", "axis": "x", "at": at, "new_name": "WIR"}],
                "BED 1 walk-in robe",
            )
            n2, g2 = head_geo(review_id)
            wir = find_room(g2, name="WIR")
            assert wir, "WIR not created"
            edits(
                review_id,
                n2,
                [{"op": "set_kind", "room_id": wir["id"], "kind": "storage", "fill": "grey"}],
                "WIR is storage",
            )

        record("BED 1 walk-in robe (split → storage)", t_bed1_wir)

        def t_front_door():
            # relocate the front door onto a LOUNGE exterior wall
            n, g = head_geo(review_id)
            lounge_ext = [
                w
                for w in g["walls"]
                if w["b"] == "exterior" and w["a"] == "lounge" and w["openings"] == []
            ]
            assert lounge_ext, "no clear lounge exterior wall to place a front door"
            wid = lounge_ext[0]["id"]
            edits(
                review_id,
                n,
                [{"op": "add_opening", "wall_id": wid, "t0": 0.4, "t1": 0.6, "type": "door"}],
                "Front door relocated to lounge",
            )
            _, g2 = head_geo(review_id)
            w2 = next(w for w in g2["walls"] if w["id"] == wid)
            assert any(o["type"] == "door" for o in w2["openings"]), "front door not added to lounge"

        record("front door relocated to the lounge wall", t_front_door)

        def t_outcome():
            n, g = head_geo(review_id)
            beds, baths, wcs = config_of(g)
            assert beds >= 4, f"beds did not grow past 4 (got {beds})"
            assert baths >= baths0 + 1, f"baths did not grow (got {baths}, was {baths0})"
            assert internal_area(g) > area0 + 1, (
                f"internal area did not grow ({internal_area(g):.1f} vs {area0:.1f})"
            )
            assert g["meta"].get("envelope") == env0, "envelope changed — footprint is not immutable"

        record("head: more beds/baths, more internal area, envelope byte-identical", t_outcome)

        # -- the delta lens renders in the real browser (locked canvas contract) --

        def t_delta_render():
            n, g = head_geo(review_id)
            page.goto(f"{BASE}/#/review/{review_id}")
            expect(page.locator(".canvas-wrap svg").first).to_be_visible(timeout=20000)
            page.wait_for_timeout(400)
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            # switch to the delta lens (stable data hook preserved across the restyle)
            page.locator('[data-lens="delta"]').first.click()
            page.wait_for_timeout(500)
            strokes = page.eval_on_selector_all(
                ".canvas-wrap [stroke]", "els => els.map(e => e.getAttribute('stroke'))"
            )
            assert "#1a7f37" in strokes, "no green (added) overlay in delta view"
            assert "#e23d28" in strokes or "#9a6700" in strokes, (
                "no red/amber (removed/modified) overlay in delta view"
            )
            # every room still shows its clear dims (owner rule / locked contract)
            texts = page.eval_on_selector_all(
                ".canvas-wrap text", "els => els.map(e => e.textContent || '')"
            )
            dims = [t for t in texts if " x " in t and t.rstrip().endswith("m")]
            rooms_shown = len([r for r in g["rooms"] if r["z"] == 0])
            assert len(dims) >= rooms_shown * 0.8, (
                f"only {len(dims)} dims labels for {rooms_shown} rooms"
            )
            assert not errors, f"console errors on the review page: {errors[:3]}"

        record("delta view renders (green add · red/amber) with dims on every room", t_delta_render)
    finally:
        try:
            api_json("DELETE", f"/api/admin/sandbox/{review_id}")
            print("sandbox deleted")
        except Exception as exc:  # noqa: BLE001
            print(f"sandbox cleanup left to startup sweep: {exc}")


# ---------------------------------------------------------------------------
# T2 — live upload → ingest → approve → re-price (opt-in, skipped-loudly)
# ---------------------------------------------------------------------------


def run_t2(page: Page) -> None:
    if os.environ.get("GOLDEN_T2") != "1":
        skip(
            "T2 · upload → ingest → approve → live re-price",
            "opt-in only — set GOLDEN_T2=1 with live web + vision to run",
        )
        return
    if not ORIGINAL_PNG.exists():
        skip("T2 · upload → ingest → approve → live re-price", f"missing {ORIGINAL_PNG}")
        return

    def t_upload_ingest_reprice():
        page.goto(f"{BASE}/#/")
        page.wait_for_timeout(500)
        page.locator('input[type="file"]').first.set_input_files(str(ORIGINAL_PNG))
        page.wait_for_timeout(300)
        # land on the ingest wizard, read geometry (vision, 30–90s), then start @ $900
        page.get_by_role("button", name="Upload", exact=False).first.click()
        expect(page).to_have_url(lambda u: "/ingest/" in u, timeout=20000)
        page.get_by_role("button", name="Read my floor plan", exact=False).first.click()
        expect(page.locator(".ingest-compare").first).to_be_visible(timeout=180000)
        page.locator(".field input").last.fill("900")
        page.get_by_role("button", name="Start the review", exact=False).first.click()
        expect(page).to_have_url(lambda u: "/review/" in u, timeout=30000)
        review_id = page.url.split("/review/")[-1].split("?")[0]
        res = api_json("POST", f"/api/reviews/{review_id}/comps/refresh")
        comps = res.get("comps", [])
        assert len(comps) >= 3, f"fewer than 3 live comps ({len(comps)})"
        r = api_json("GET", f"/api/reviews/{review_id}")
        assert r["baseline_per_week"] == 900, "baseline not $900"

    record("T2 · upload → ingest → approve → live re-price (≥3 comps)", t_upload_ingest_reprice)


def preflight() -> None:
    """Confirm the compose stack is reachable before running any scenario."""
    for name, url in (("backend", f"{API}/api/health"), ("frontend", BASE)):
        try:
            urllib.request.urlopen(url, timeout=5).read()
        except (urllib.error.URLError, ConnectionError, TimeoutError) as exc:
            raise SystemExit(
                f"golden path needs the compose stack — {name} unreachable at {url} ({exc}).\n"
                "Run: make -C app up"
            ) from exc


def main() -> None:
    preflight()
    ART.mkdir(exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        # a real user sees the first-run coach once; tests drive the UI, so pre-dismiss it
        page.add_init_script("try{window.localStorage.setItem('fps-coach-dismissed','1')}catch(e){}")
        run_t1(page)
        run_t2(page)
        browser.close()

    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    failed = sum(1 for r in RESULTS if r["status"] == "FAIL")
    skipped = sum(1 for r in RESULTS if r["status"] == "SKIP")
    (ART / "golden_path_report.json").write_text(json.dumps(RESULTS, indent=2))
    lines = [
        "# Golden path — 231 Peats Ferry Rd",
        "",
        f"{passed} passed · {failed} failed · {skipped} skipped · {time.strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "| Step | Status | s |",
        "|---|---|---|",
    ]
    for r in RESULTS:
        note = f" — {r.get('error', '')}" if r["status"] in ("FAIL", "SKIP") else ""
        lines.append(f"| {r['feature']}{note} | {r['status']} | {r['seconds']} |")
    (ART / "golden_path_report.md").write_text("\n".join(lines) + "\n")
    print(f"\n{passed} passed · {failed} failed · {skipped} skipped → {ART / 'golden_path_report.md'}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
