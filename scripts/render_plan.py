#!/usr/bin/env python3
"""Render a styled floor plan (propose_v##_plan.png) from a plan_v##.json geometry model.

Reproduces the professional listing-plan style (see examples/floorplan-styling.webp):
white background, thick black walls, room names in caps with dimensions, grey
outdoor/utility zones, and an address title block. Deterministic — geometry lives in
the JSON, this script only draws.

Usage:
    uv run python scripts/render_plan.py <property>/plan_v02.json
    uv run python scripts/render_plan.py <property>/plan_v02.json --out preview.png

Coordinates in the JSON are metres; the renderer scales by px_per_m (default 60).
Rooms are rectangles; walls are drawn by expanding each room outline. Openings are
white rectangles punched through walls afterwards. z=1 rooms (robes, linen) are
drawn nested inside z=0 rooms.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

BLACK = (20, 20, 22)
WHITE = (255, 255, 255)
GREY = (225, 225, 227)
FAINT = (120, 120, 124)

FontT = ImageFont.FreeTypeFont | ImageFont.ImageFont

_REGULAR = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
]
_BOLD = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]
_font_cache: dict[tuple[int, bool], FontT] = {}


def _font(size: int, bold: bool = False) -> FontT:
    key = (size, bold)
    if key not in _font_cache:
        for path in (_BOLD if bold else _REGULAR) + _REGULAR:
            try:
                _font_cache[key] = ImageFont.truetype(path, size)
                break
            except OSError:
                continue
        else:
            _font_cache[key] = ImageFont.load_default(size)
    return _font_cache[key]


def _fit_label(
    draw: ImageDraw.ImageDraw, lines: list[tuple[str, bool]], box_w: int, box_h: int
) -> list[tuple[str, FontT, int]] | None:
    """Fit name/dims lines into a room. Returns [(text, font, line_h)] or None if hopeless."""
    for size in range(20, 7, -1):
        fitted: list[tuple[str, FontT, int]] = []
        total_h = 0
        ok = True
        for text, bold in lines:
            font = _font(size if bold else max(size - 3, 7), bold)
            if draw.textlength(text, font=font) > box_w - 8:
                ok = False
                break
            line_h = round((size if bold else size - 3) * 1.35)
            fitted.append((text, font, line_h))
            total_h += line_h
        if ok and total_h <= box_h - 6:
            return fitted
    return None


def _draw_room_labels(
    draw: ImageDraw.ImageDraw, room: dict[str, Any], s: float, ox: int, oy: int
) -> None:
    name = str(room.get("name", "")).strip()
    if not name:
        return
    name_lines: list[tuple[str, bool]] = [(part, True) for part in name.upper().split("\n")]
    # Every room shows dimensions: auto-derived from geometry unless overridden; "-" suppresses.
    dims = str(room.get("dims", "")).strip() or f"{room['w']:.1f} x {room['h']:.1f}m"
    x, y = ox + room["x"] * s, oy + room["y"] * s
    w, h = room["w"] * s, room["h"] * s
    fitted = None
    if dims != "-":
        fitted = _fit_label(draw, name_lines + [(dims, False)], int(w), int(h))
    if fitted is None:
        fitted = _fit_label(draw, name_lines, int(w), int(h))
    if fitted is None:
        return
    total_h = sum(line_h for _, _, line_h in fitted)
    ty = y + (h - total_h) / 2
    for text, font, line_h in fitted:
        tx = x + (w - draw.textlength(text, font=font)) / 2
        draw.text((tx, ty), text, font=font, fill=BLACK)
        ty += line_h


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a styled floor plan from plan_v##.json.")
    parser.add_argument("plan_json", type=Path, help="path to plan_v##.json")
    parser.add_argument("--out", type=Path, default=None, help="override output PNG path")
    args = parser.parse_args()

    spec: dict[str, Any] = json.loads(args.plan_json.read_text())
    version = int(spec.get("version", 0))
    if version < 1:
        sys.exit("error: json must declare an integer 'version' >= 1")

    s = float(spec.get("px_per_m", 60))
    wall = float(spec.get("wall_m", 0.12)) * s
    rooms: list[dict[str, Any]] = spec.get("rooms", [])
    openings: list[dict[str, Any]] = spec.get("openings", [])
    if not rooms:
        sys.exit("error: no rooms in plan json")

    margin = round(0.8 * s)
    extent_w = max(r["x"] + r["w"] for r in rooms) * s
    extent_h = max(r["y"] + r["h"] for r in rooms) * s
    title_lines = [
        t for t in [spec.get("floor_label"), spec.get("address"), spec.get("subtitle")] if t
    ]
    title_h = 90 + 34 * len(title_lines)
    width = round(extent_w) + 2 * margin
    height = round(extent_h) + 2 * margin + title_h

    image = Image.new("RGB", (width, height), WHITE)
    draw = ImageDraw.Draw(image)
    ox, oy = margin, margin

    def rect(r: dict[str, Any], grow: float = 0.0) -> tuple[float, float, float, float]:
        return (
            ox + r["x"] * s - grow,
            oy + r["y"] * s - grow,
            ox + (r["x"] + r["w"]) * s + grow,
            oy + (r["y"] + r["h"]) * s + grow,
        )

    for z in (0, 1):
        level = [r for r in rooms if int(r.get("z", 0)) == z]
        for room in level:
            draw.rectangle(rect(room, grow=wall), fill=BLACK)
        for room in level:
            fill = GREY if room.get("fill") == "grey" else WHITE
            draw.rectangle(rect(room, grow=-wall * 0.5), fill=fill)

    for opening in openings:
        draw.rectangle(rect(opening), fill=WHITE)

    fixtures: list[dict[str, Any]] = spec.get("fixtures", [])
    for fixture in fixtures:
        draw.rectangle(rect(fixture), outline=BLACK, width=2)

    for room in rooms:
        _draw_room_labels(draw, room, s, ox, oy)

    ty = round(extent_h) + 2 * margin + 20
    internal = sum(
        r["w"] * r["h"] for r in rooms if int(r.get("z", 0)) == 0 and r.get("fill") != "grey"
    )
    for i, line in enumerate(title_lines):
        font = _font(26 if i < 2 else 18, bold=i < 2)
        draw.text(
            ((width - draw.textlength(str(line).upper(), font=font)) / 2, ty),
            str(line).upper(),
            font=font,
            fill=BLACK,
        )
        ty += 38 if i < 2 else 26
    area_line = f"APPROX. INTERNAL FLOOR AREA: {internal:.0f} SQM"
    font = _font(16)
    draw.text(
        ((width - draw.textlength(area_line, font=font)) / 2, ty), area_line, font=font, fill=BLACK
    )
    ty += 30
    disclaimer = str(
        spec.get(
            "disclaimer",
            "Scale in metres. Indicative only. Dimensions approximate. "
            "Concept proposal — not architectural, planning, or financial advice.",
        )
    )
    font = _font(12)
    draw.text(
        ((width - draw.textlength(disclaimer, font=font)) / 2, ty),
        disclaimer,
        font=font,
        fill=FAINT,
    )

    out = args.out or args.plan_json.parent / f"propose_v{version:02d}_plan.png"
    image.save(out)
    print(
        f"wrote {out} ({len(rooms)} rooms, {len(openings)} openings, {internal:.0f} sqm internal)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
