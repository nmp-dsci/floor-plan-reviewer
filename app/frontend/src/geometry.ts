import type { PlanGeometry, PlanLevel, Room, Wall } from './types';
// (wall helpers are defined below; clear-size functions at the bottom use them)

export const DEFAULT_LEVEL = 'level-1';

const levelName = (id: string): string =>
  id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const roomLevel = (r: Room): string => r.level ?? DEFAULT_LEVEL;

/** Ordered [{id,name}] for the tab strip — from meta.levels, else derived from rooms. */
export function planLevels(geo: PlanGeometry): PlanLevel[] {
  const meta = (geo.meta['levels'] as PlanLevel[] | undefined) ?? [];
  if (meta.length > 0) return meta.map((l) => ({ id: l.id, name: l.name || levelName(l.id) }));
  const seen: string[] = [];
  for (const r of geo.rooms) if (!seen.includes(roomLevel(r))) seen.push(roomLevel(r));
  const ids = seen.length > 0 ? seen : [DEFAULT_LEVEL];
  return ids.map((id) => ({ id, name: levelName(id) }));
}

/** Pinned footprint of one level, falling back to legacy single envelope / bbox. */
export function envelopeForLevel(geo: PlanGeometry, levelId: string): [number, number, number, number] {
  const envelopes = geo.meta['envelopes'] as Record<string, number[]> | undefined;
  const env = envelopes?.[levelId];
  if (env) return [env[0], env[1], env[2], env[3]];
  const rooms = geo.rooms.filter((r) => roomLevel(r) === levelId);
  if (rooms.length === 0) return (geo.meta['envelope'] as [number, number, number, number]) ?? bbox(geo.rooms);
  if (planLevels(geo).length === 1 && geo.meta['envelope'])
    return geo.meta['envelope'] as [number, number, number, number];
  return bbox(rooms);
}

/** A single level's slice of the plan: only its rooms/walls/fixtures, with meta.envelope
 * set to that level's footprint so the existing canvas/viewport render it unchanged. */
export function levelGeometry(geo: PlanGeometry, levelId: string): PlanGeometry {
  const rooms = geo.rooms.filter((r) => roomLevel(r) === levelId);
  const roomIds = new Set(rooms.map((r) => r.id));
  return {
    ...geo,
    rooms,
    walls: geo.walls.filter((w) => roomIds.has(w.a)),
    fixtures: geo.fixtures.filter((f) => (f.level ?? DEFAULT_LEVEL) === levelId),
    meta: { ...geo.meta, envelope: envelopeForLevel(geo, levelId) },
  };
}

export const PX_PER_M = 60;
export const MARGIN_M = 0.8;
export const INTERIOR_HALF = 0.09;
export const EXTERIOR_HALF = 0.11;

export interface Viewport {
  ox: number; // px offset applied to metre coords
  oy: number;
  width: number;
  height: number;
}

export function viewport(geo: PlanGeometry): Viewport {
  const env = (geo.meta['envelope'] as number[] | undefined) ?? bbox(geo.rooms);
  const [x0, y0, x1, y1] = env;
  const margin = MARGIN_M * PX_PER_M;
  return {
    ox: margin - x0 * PX_PER_M,
    oy: margin - y0 * PX_PER_M,
    width: (x1 - x0) * PX_PER_M + 2 * margin,
    height: (y1 - y0) * PX_PER_M + 2 * margin,
  };
}

function bbox(rooms: Room[]): [number, number, number, number] {
  return [
    Math.min(...rooms.map((r) => r.x)),
    Math.min(...rooms.map((r) => r.y)),
    Math.max(...rooms.map((r) => r.x + r.w)),
    Math.max(...rooms.map((r) => r.y + r.h)),
  ];
}

export const px = (m: number) => m * PX_PER_M;

export function wallHalf(w: Wall): number {
  return (w.b === 'exterior' ? EXTERIOR_HALF : INTERIOR_HALF) * PX_PER_M;
}

export function wallIsVertical(w: Wall): boolean {
  return Math.abs(w.line[0] - w.line[2]) < 1e-9;
}

export function wallSpan(w: Wall): [number, number] {
  const [x1, y1, x2, y2] = w.line;
  return wallIsVertical(w) ? [Math.min(y1, y2), Math.max(y1, y2)] : [Math.min(x1, x2), Math.max(x1, x2)];
}

export function wallCoord(w: Wall): number {
  return wallIsVertical(w) ? w.line[0] : w.line[1];
}

export function wallLength(w: Wall): number {
  const [lo, hi] = wallSpan(w);
  return hi - lo;
}

export function tToAbs(w: Wall, t: number): number {
  const [lo, hi] = wallSpan(w);
  return lo + t * (hi - lo);
}

export function absToT(w: Wall, v: number): number {
  const [lo, hi] = wallSpan(w);
  return hi <= lo ? 0 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

export interface RoomDiff {
  removed: Room[]; // present in original, gone in proposed (draw as red ghosts)
  added: Set<string>; // room ids new in proposed (green)
  modified: Map<string, Room>; // id → original room (label WAS → NOW)
}

export function diffRooms(original: PlanGeometry, proposed: PlanGeometry): RoomDiff {
  const orig = new Map(original.rooms.map((r) => [r.id, r]));
  const prop = new Map(proposed.rooms.map((r) => [r.id, r]));
  const removed: Room[] = [];
  const added = new Set<string>();
  const modified = new Map<string, Room>();
  for (const [id, r] of orig) if (!prop.has(id)) removed.push(r);
  for (const [id, r] of prop) {
    const o = orig.get(id);
    if (!o) {
      added.add(id);
    } else if (
      Math.abs(o.x - r.x) + Math.abs(o.y - r.y) + Math.abs(o.w - r.w) + Math.abs(o.h - r.h) > 0.05 ||
      o.name !== r.name ||
      o.kind !== r.kind ||
      o.fill !== r.fill
    ) {
      modified.set(id, o);
    }
  }
  return { removed, added, modified };
}

export function snapM(v: number, step = 0.05): number {
  return Math.round(v / step) * step;
}

// ---- wall derivation (TS mirror of plan_core.walls.derive_walls) ----
// Used to re-derive walls in the local edit preview so a moved/added wall shows in
// its new position before the change is applied on the server. Kept in lock-step with
// walls.py: per-level grouping, GAP_TOL adjacency, exterior = uncovered edge segments.
const GAP_TOL = 0.35;
const MIN_SHARED = 0.3;
type Interval = [number, number];
const rx2 = (r: Room) => r.x + r.w;
const ry2 = (r: Room) => r.y + r.h;

function overlapIv(a0: number, a1: number, b0: number, b1: number): Interval | null {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return hi - lo >= MIN_SHARED ? [lo, hi] : null;
}

function subtractIv(base: Interval, covers: Interval[]): Interval[] {
  let pieces: Interval[] = [base];
  for (const [c0, c1] of [...covers].sort((p, q) => p[0] - q[0])) {
    const next: Interval[] = [];
    for (const [p0, p1] of pieces) {
      if (c1 <= p0 || c0 >= p1) {
        next.push([p0, p1]);
        continue;
      }
      if (c0 - p0 >= MIN_SHARED) next.push([p0, c0]);
      if (p1 - c1 >= MIN_SHARED) next.push([c1, p1]);
    }
    pieces = next;
  }
  return pieces;
}

function deriveWallsOneLevel(rooms: Room[]): Wall[] {
  const z0 = rooms.filter((r) => r.z === 0).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const z1 = rooms.filter((r) => r.z !== 0).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const walls: Wall[] = [];
  const coverage = new Map<string, Interval[]>();
  const cover = (rid: string, edge: string, iv: Interval) => {
    const k = `${rid}|${edge}`;
    const cur = coverage.get(k);
    if (cur) cur.push(iv);
    else coverage.set(k, [iv]);
  };
  const addWall = (a: string, b: string, line: [number, number, number, number]) => {
    const [first, second] = b !== 'exterior' ? [a, b].sort() : [a, b];
    const k = walls.filter((w) => w.a === first && w.b === second).length;
    walls.push({ id: `w:${first}|${second}:${k}`, a: first, b: second, line, t: 0.12, openings: [] });
  };
  for (let i = 0; i < z0.length; i++) {
    for (let j = i + 1; j < z0.length; j++) {
      const ra = z0[i];
      const rb = z0[j];
      for (const [lft, rgt] of [[ra, rb], [rb, ra]] as [Room, Room][]) {
        if (Math.abs(rx2(lft) - rgt.x) <= GAP_TOL) {
          const iv = overlapIv(lft.y, ry2(lft), rgt.y, ry2(rgt));
          if (iv) {
            const xm = (rx2(lft) + rgt.x) / 2;
            addWall(lft.id, rgt.id, [xm, iv[0], xm, iv[1]]);
            cover(lft.id, 'right', iv);
            cover(rgt.id, 'left', iv);
          }
        }
      }
      for (const [top, bot] of [[ra, rb], [rb, ra]] as [Room, Room][]) {
        if (Math.abs(ry2(top) - bot.y) <= GAP_TOL) {
          const iv = overlapIv(top.x, rx2(top), bot.x, rx2(bot));
          if (iv) {
            const ym = (ry2(top) + bot.y) / 2;
            addWall(top.id, bot.id, [iv[0], ym, iv[1], ym]);
            cover(top.id, 'bottom', iv);
            cover(bot.id, 'top', iv);
          }
        }
      }
    }
  }
  for (const nr of z1) {
    const parent = z0.find(
      (p) => nr.x >= p.x - 0.11 && nr.y >= p.y - 0.11 && rx2(nr) <= rx2(p) + 0.11 && ry2(nr) <= ry2(p) + 0.11,
    );
    const pid = parent ? parent.id : 'exterior';
    addWall(nr.id, pid, [nr.x, nr.y, rx2(nr), nr.y]);
    addWall(nr.id, pid, [nr.x, ry2(nr), rx2(nr), ry2(nr)]);
    addWall(nr.id, pid, [nr.x, nr.y, nr.x, ry2(nr)]);
    addWall(nr.id, pid, [rx2(nr), nr.y, rx2(nr), ry2(nr)]);
  }
  const edgeSpecs: [string, boolean][] = [
    ['left', true],
    ['right', true],
    ['top', false],
    ['bottom', false],
  ];
  for (const r of z0) {
    for (const [edge, vert] of edgeSpecs) {
      const base: Interval = vert ? [r.y, ry2(r)] : [r.x, rx2(r)];
      const coord = edge === 'left' ? r.x : edge === 'right' ? rx2(r) : edge === 'top' ? r.y : ry2(r);
      for (const iv of subtractIv(base, coverage.get(`${r.id}|${edge}`) ?? [])) {
        const line: [number, number, number, number] = vert
          ? [coord, iv[0], coord, iv[1]]
          : [iv[0], coord, iv[1], coord];
        addWall(r.id, 'exterior', line);
      }
    }
  }
  return walls;
}

/** Re-derive walls from room rectangles (per level), preserving each wall's openings
 * by id where the same wall still exists. Mirrors plan_core.walls.derive_walls. */
export function deriveWalls(rooms: Room[], prev: Wall[] = []): Wall[] {
  const levels: string[] = [];
  for (const r of rooms) {
    const lv = r.level ?? DEFAULT_LEVEL;
    if (!levels.includes(lv)) levels.push(lv);
  }
  const walls =
    levels.length <= 1
      ? deriveWallsOneLevel(rooms)
      : levels.flatMap((lv) => deriveWallsOneLevel(rooms.filter((r) => (r.level ?? DEFAULT_LEVEL) === lv)));
  const openingsById = new Map(prev.map((w) => [w.id, w.openings]));
  for (const w of walls) {
    const carried = openingsById.get(w.id);
    if (carried) w.openings = carried.map((o) => ({ ...o }));
  }
  return walls;
}

// ---- clear dimensions (the ONE dimension standard — walls subtracted) ----
// Mirrors plan_core.dims exactly: rect span minus each side's wall encroachment
// (wall inner face past the room edge). Authored dims strings are retired.
const CLEAR_COORD_TOL = 0.4;
const CLEAR_MIN_OVERLAP = 0.3;

function encroachment(room: Room, walls: Wall[], edge: 'left' | 'right' | 'top' | 'bottom'): number {
  const vertical = edge === 'left' || edge === 'right';
  const coord =
    edge === 'left' ? room.x : edge === 'right' ? room.x + room.w : edge === 'top' ? room.y : room.y + room.h;
  const span: [number, number] = vertical ? [room.y, room.y + room.h] : [room.x, room.x + room.w];
  let enc = 0;
  for (const w of walls) {
    if (wallIsVertical(w) !== vertical) continue;
    if (w.a !== room.id && w.b !== room.id) continue;
    const c = wallCoord(w);
    if (Math.abs(c - coord) > CLEAR_COORD_TOL) continue;
    const [lo, hi] = wallSpan(w);
    if (Math.min(hi, span[1]) - Math.max(lo, span[0]) < CLEAR_MIN_OVERLAP) continue;
    const half = w.b === 'exterior' ? EXTERIOR_HALF : INTERIOR_HALF;
    const inner = edge === 'left' || edge === 'top' ? c + half : c - half;
    const e = edge === 'left' || edge === 'top' ? inner - coord : coord - inner;
    if (e > enc) enc = e;
  }
  return enc;
}

export function clearSize(room: Room, walls: Wall[]): { w: number; h: number } {
  const w =
    room.w - encroachment(room, walls, 'left') - encroachment(room, walls, 'right');
  const h =
    room.h - encroachment(room, walls, 'top') - encroachment(room, walls, 'bottom');
  return { w: Math.max(w, 0), h: Math.max(h, 0) };
}

export function clearDims(room: Room, walls: Wall[]): string {
  const { w, h } = clearSize(room, walls);
  return `${w.toFixed(2)} x ${h.toFixed(2)}m`;
}
