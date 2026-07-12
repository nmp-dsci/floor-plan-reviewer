import type { PlanGeometry, Room, Wall } from './types';

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

export function autoDims(room: Room): string {
  if (room.dims === '-') return '';
  return room.dims || `${room.w.toFixed(1)} x ${room.h.toFixed(1)}m`;
}
