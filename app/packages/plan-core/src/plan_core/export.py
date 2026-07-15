"""Render schema-v2 geometry to the listing-style PNG (parity with scripts/render_plan.py).

Same visual language: white paper, black walls (exterior slightly thicker),
caps room names with the dims-on-every-room rule, grey utility zones, outlined
fixtures, address title block with auto-computed internal area.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from plan_core.dims import clear_dims_label, clear_internal_area
from plan_core.schema import Fixture, PlanGeometry, Room, Wall

BLACK = (20, 20, 22)
WHITE = (255, 255, 255)
GREY = (225, 225, 227)
FAINT = (120, 120, 124)

PX_PER_M = 60.0
MARGIN_M = 0.8
INTERIOR_HALF = 0.09  # wall half-thickness (m) — interior
EXTERIOR_HALF = 0.11

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


def _draw_labels(
    draw: ImageDraw.ImageDraw, room: Room, walls: list[Wall], ox: float, oy: float
) -> None:
    name = room.name.strip()
    if not name:
        return
    name_lines: list[tuple[str, bool]] = [(part, True) for part in name.upper().split()]
    if len(name_lines) > 2:
        name_lines = [(name.upper(), True)]
    # one dimension standard: clear size (wall faces), never the authored string
    dims = clear_dims_label(room, walls)
    x, y = ox + room.x * PX_PER_M, oy + room.y * PX_PER_M
    w, h = room.w * PX_PER_M, room.h * PX_PER_M
    fitted = _fit_label(draw, [(name.upper(), True), (dims, False)], int(w), int(h))
    if fitted is None:
        fitted = _fit_label(draw, [(name.upper(), True)], int(w), int(h))
    if fitted is None:
        return
    total_h = sum(line_h for _, _, line_h in fitted)
    ty = y + (h - total_h) / 2
    for text, font, line_h in fitted:
        tx = x + (w - draw.textlength(text, font=font)) / 2
        draw.text((tx, ty), text, font=font, fill=BLACK)
        ty += line_h


def _wall_rect(w: Wall, ox: float, oy: float) -> tuple[float, float, float, float]:
    half = (EXTERIOR_HALF if w.b == "exterior" else INTERIOR_HALF) * PX_PER_M
    lo, hi = w.span()
    if w.vertical:
        return (
            ox + w.coord * PX_PER_M - half,
            oy + lo * PX_PER_M - half,
            ox + w.coord * PX_PER_M + half,
            oy + hi * PX_PER_M + half,
        )
    return (
        ox + lo * PX_PER_M - half,
        oy + w.coord * PX_PER_M - half,
        ox + hi * PX_PER_M + half,
        oy + w.coord * PX_PER_M + half,
    )


@dataclass
class _Panel:
    """One level laid out for side-by-side rendering."""

    name: str
    rooms: list[Room]
    walls: list[Wall]
    fixtures: list[Fixture]
    ex0: float
    ey0: float
    pw: int
    ph: int


def _draw_plan(
    draw: ImageDraw.ImageDraw,
    rooms: list[Room],
    walls: list[Wall],
    fixtures: list[Fixture],
    ox: float,
    oy: float,
) -> None:
    """Draw one plan (a single level's rooms/walls/openings/fixtures/labels) at offset."""
    for z in (0, 1):
        for room in (r for r in rooms if r.z == z):
            draw.rectangle(
                (
                    ox + room.x * PX_PER_M,
                    oy + room.y * PX_PER_M,
                    ox + room.x2 * PX_PER_M,
                    oy + room.y2 * PX_PER_M,
                ),
                fill=GREY if room.fill == "grey" else WHITE,
            )
        nested_ids = {r.id for r in rooms if r.z != 0}
        for wall in walls:
            wall_is_nested = wall.a in nested_ids or wall.b in nested_ids
            if (z == 1) == wall_is_nested:
                draw.rectangle(_wall_rect(wall, ox, oy), fill=BLACK)

    # openings punch through their wall; windows keep two thin edge lines
    for wall in walls:
        half = (EXTERIOR_HALF if wall.b == "exterior" else INTERIOR_HALF) * PX_PER_M + 2
        for o in wall.openings:
            a0, a1 = wall.t_to_abs(o.t0), wall.t_to_abs(o.t1)
            if wall.vertical:
                x0, y0 = ox + wall.coord * PX_PER_M - half, oy + a0 * PX_PER_M
                x1, y1 = ox + wall.coord * PX_PER_M + half, oy + a1 * PX_PER_M
            else:
                x0, y0 = ox + a0 * PX_PER_M, oy + wall.coord * PX_PER_M - half
                x1, y1 = ox + a1 * PX_PER_M, oy + wall.coord * PX_PER_M + half
            draw.rectangle((x0, y0, x1, y1), fill=WHITE)
            if o.type == "window":
                if wall.vertical:
                    draw.line((x0 + 1, y0, x0 + 1, y1), fill=BLACK, width=2)
                    draw.line((x1 - 1, y0, x1 - 1, y1), fill=BLACK, width=2)
                else:
                    draw.line((x0, y0 + 1, x1, y0 + 1), fill=BLACK, width=2)
                    draw.line((x0, y1 - 1, x1, y1 - 1), fill=BLACK, width=2)

    for fx in fixtures:
        draw.rectangle(
            (
                ox + fx.x * PX_PER_M,
                oy + fx.y * PX_PER_M,
                ox + (fx.x + fx.w) * PX_PER_M,
                oy + (fx.y + fx.h) * PX_PER_M,
            ),
            outline=BLACK,
            width=2,
        )

    for room in rooms:
        _draw_labels(draw, room, walls, ox, oy)


def render_png(
    geo: PlanGeometry,
    out_path: str | Path,
    floor_label: str = "",
    subtitle: str = "",
) -> Path:
    margin = round(MARGIN_M * PX_PER_M)
    levels = geo.levels()
    multi = len(levels) > 1
    caption_h = 40 if multi else 0
    gutter = margin

    room_level = {r.id: r.level for r in geo.rooms}
    panels: list[_Panel] = []
    for lvl in levels:
        lid = lvl["id"]
        px0, py0, px1, py1 = geo.envelope_for(lid)
        panels.append(
            _Panel(
                name=lvl["name"],
                rooms=geo.rooms_on(lid),
                walls=[w for w in geo.walls if room_level.get(w.a) == lid],
                fixtures=[f for f in geo.fixtures if f.level == lid],
                ex0=px0,
                ey0=py0,
                pw=round((px1 - px0) * PX_PER_M) + 2 * margin,
                ph=round((py1 - py0) * PX_PER_M) + 2 * margin,
            )
        )

    plans_w = sum(p.pw for p in panels) + gutter * (len(panels) - 1)
    plans_h = max(p.ph for p in panels)
    title_lines = [t for t in (floor_label, geo.address, subtitle) if t]
    title_h = 90 + 34 * len(title_lines)
    width = plans_w
    height = caption_h + plans_h + title_h

    image = Image.new("RGB", (width, height), WHITE)
    draw = ImageDraw.Draw(image)

    cursor_x = 0
    for p in panels:
        ox = cursor_x + margin - p.ex0 * PX_PER_M
        oy = caption_h + margin - p.ey0 * PX_PER_M
        if multi:
            cap = _font(18, bold=True)
            name = p.name.upper()
            draw.text(
                (cursor_x + (p.pw - draw.textlength(name, font=cap)) / 2, 10),
                name,
                font=cap,
                fill=BLACK,
            )
        _draw_plan(draw, p.rooms, p.walls, p.fixtures, ox, oy)
        cursor_x += p.pw + gutter

    ty = caption_h + plans_h + 20
    for i, line in enumerate(title_lines):
        font = _font(26 if i < 2 else 18, bold=i < 2)
        text = str(line).upper()
        draw.text(((width - draw.textlength(text, font=font)) / 2, ty), text, font=font, fill=BLACK)
        ty += 38 if i < 2 else 26
    area_line = f"APPROX. INTERNAL FLOOR AREA: {clear_internal_area(geo):.0f} SQM (CLEAR)"
    font = _font(16)
    draw.text(
        ((width - draw.textlength(area_line, font=font)) / 2, ty), area_line, font=font, fill=BLACK
    )
    ty += 30
    disclaimer = (
        "Scale in metres. Indicative only. Dimensions approximate. "
        "Concept proposal — not architectural, planning, or financial advice."
    )
    font = _font(12)
    draw.text(
        ((width - draw.textlength(disclaimer, font=font)) / 2, ty),
        disclaimer,
        font=font,
        fill=FAINT,
    )

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)
    return out
