#!/usr/bin/env python3
"""Render propose_v##.png from a cumulative changes_v##.json.

Draws labelled proposal boxes over the property's base floor-plan image in the
propose_v1 style: white fill, red border, centred black text.

Usage:
    uv run python scripts/render_overlay.py <property>/changes_v02.json
    uv run python scripts/render_overlay.py <property>/changes_v02.json --out preview.png

The base image (default original.png) is resolved relative to the JSON file.
Output defaults to propose_v{version:02d}.png next to the JSON file.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

BORDER_COLOR = (226, 61, 40)
TEXT_COLOR = (17, 17, 17)
BOX_FILL = (255, 255, 255)
MIN_BOX_PX = 8

FontT = ImageFont.FreeTypeFont | ImageFont.ImageFont

_FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
]
_font_cache: dict[int, FontT] = {}


def _font(size: int) -> FontT:
    if size not in _font_cache:
        for path in _FONT_CANDIDATES:
            try:
                _font_cache[size] = ImageFont.truetype(path, size)
                break
            except OSError:
                continue
        else:
            _font_cache[size] = ImageFont.load_default(size)
    return _font_cache[size]


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: FontT, max_w: float) -> list[str]:
    """Word-wrap text to max_w pixels; explicit \\n breaks are preserved."""
    lines: list[str] = []
    for raw in text.split("\n"):
        words = raw.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if draw.textlength(candidate, font=font) <= max_w:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def _fit(
    draw: ImageDraw.ImageDraw, text: str, box_w: int, box_h: int, pad: int
) -> tuple[FontT, list[str], int]:
    """Largest font size whose wrapped text fits the box."""
    max_size = min(34, box_h - 2 * pad)
    for size in range(max_size, 9, -1):
        font = _font(size)
        max_w = box_w - 2 * pad
        lines = _wrap(draw, text, font, max_w)
        line_h = round(size * 1.3)
        fits_w = all(draw.textlength(line, font=font) <= max_w for line in lines)
        if fits_w and line_h * len(lines) <= box_h - 2 * pad:
            return font, lines, line_h
    font = _font(10)
    return font, _wrap(draw, text, font, max(box_w - 2 * pad, 1)), 13


def _draw_box(draw: ImageDraw.ImageDraw, box: dict[str, Any], border_w: int) -> None:
    x, y, w, h = int(box["x"]), int(box["y"]), int(box["w"]), int(box["h"])
    style = box.get("style", "filled")
    rect = (x, y, x + w, y + h)
    if style == "filled":
        draw.rectangle(rect, fill=BOX_FILL, outline=BORDER_COLOR, width=border_w)
    else:
        draw.rectangle(rect, outline=BORDER_COLOR, width=border_w)

    label = str(box.get("label", "")).strip()
    if not label:
        return
    pad = max(6, border_w + 2)
    font, lines, line_h = _fit(draw, label, w, h, pad)
    ty = y + (h - line_h * len(lines)) / 2
    for line in lines:
        lw = draw.textlength(line, font=font)
        tx = x + (w - lw) / 2
        if style != "filled":
            draw.rectangle((tx - 3, ty - 1, tx + lw + 3, ty + line_h + 1), fill=BOX_FILL)
        draw.text((tx, ty), line, font=font, fill=TEXT_COLOR)
        ty += line_h


def _clamped(box: dict[str, Any], width: int, height: int) -> dict[str, Any] | None:
    """Clamp a box to the canvas; None if nothing meaningful remains."""
    x = max(0, min(int(box["x"]), width - 1))
    y = max(0, min(int(box["y"]), height - 1))
    w = min(int(box["w"]), width - x)
    h = min(int(box["h"]), height - y)
    if w < MIN_BOX_PX or h < MIN_BOX_PX:
        return None
    return {**box, "x": x, "y": y, "w": w, "h": h}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Render propose_v##.png from a cumulative changes_v##.json."
    )
    parser.add_argument("changes_json", type=Path, help="path to changes_v##.json")
    parser.add_argument("--out", type=Path, default=None, help="override output PNG path")
    args = parser.parse_args()

    spec: dict[str, Any] = json.loads(args.changes_json.read_text())
    folder = args.changes_json.parent
    base_path = folder / str(spec.get("base_image", "original.png"))
    if not base_path.exists():
        sys.exit(f"error: base image not found: {base_path}")

    version = int(spec.get("version", 0))
    if version < 1:
        sys.exit("error: json must declare an integer 'version' >= 1")
    name_match = re.search(r"changes_v(\d+)", args.changes_json.stem)
    if name_match and int(name_match.group(1)) != version:
        print(
            f"warning: file name says v{int(name_match.group(1))} but json says v{version}",
            file=sys.stderr,
        )

    image = Image.open(base_path).convert("RGB")
    draw = ImageDraw.Draw(image)
    border_w = max(3, round(min(image.size) * 0.005))

    changes: list[dict[str, Any]] = spec.get("changes", [])
    drawn = 0
    for change in changes:
        for box in change.get("boxes", []):
            clamped = _clamped(box, image.width, image.height)
            if clamped is None:
                print(
                    f"warning: skipping degenerate/out-of-canvas box in {change.get('id')}",
                    file=sys.stderr,
                )
                continue
            if clamped != box:
                print(f"warning: clamped a box in {change.get('id')} to canvas", file=sys.stderr)
            _draw_box(draw, clamped, border_w)
            drawn += 1

    out = args.out or folder / f"propose_v{version:02d}.png"
    image.save(out)
    print(f"wrote {out} ({len(changes)} changes, {drawn} boxes, base {base_path.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
