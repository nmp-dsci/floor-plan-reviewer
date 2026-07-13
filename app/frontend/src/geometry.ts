import type { PlanGeometry, Room, Wall } from './types';
// (wall helpers are defined below; clear-size functions at the bottom use them)

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
