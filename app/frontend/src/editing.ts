// The human editing pipeline: canvas/inspector intents compile to the SAME typed
// ops the agent emits (plan_core.ops). Ops queue as PendingEntry objects keyed by
// a client id; objects created by a pending op preview with the id `pv-<pid>` and
// are FIRST-CLASS EDITABLE — editing a pending object rewrites its op in place, so
// no preview id ever reaches the server. One Apply commits the batch as one version.

import type { Fixture, OpeningType, PlanGeometry, Wall } from './types';
import { snapM, wallIsVertical } from './geometry';

export type Op =
  | { op: 'rename'; room_id: string; name: string }
  | { op: 'set_kind'; room_id: string; kind?: string; name?: string; fill?: 'white' | 'grey' }
  | { op: 'resize_room'; room_id: string; x: number; y: number; w: number; h: number }
  | {
      op: 'add_room';
      name: string;
      kind?: string;
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: 'white' | 'grey';
    }
  | {
      op: 'split_room';
      room_id: string;
      axis: 'x' | 'y';
      at: number;
      new_name: string;
      side?: 'low' | 'high';
      gap?: number;
    }
  | { op: 'merge_rooms'; room_id: string; other_id: string; name?: string }
  | { op: 'remove_room'; room_id: string }
  | { op: 'add_opening'; wall_id: string; t0: number; t1: number; type: OpeningType }
  | { op: 'modify_opening'; opening_id: string; t0?: number; t1?: number; type?: OpeningType }
  | { op: 'remove_opening'; opening_id: string }
  | { op: 'remove_wall_chunk'; wall_id: string; t0: number; t1: number }
  | { op: 'add_fixture'; x: number; y: number; w: number; h: number; label: string }
  | {
      op: 'modify_fixture';
      fixture_id: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      label?: string;
    }
  | { op: 'remove_fixture'; fixture_id: string };

export interface PendingEntry {
  pid: string;
  op: Op;
}

export const newPid = (): string => Math.random().toString(36).slice(2, 8);

export const pvId = (pid: string): string => `pv-${pid}`;

export const pidOfPv = (id: string): string | null => (id.startsWith('pv-') ? id.slice(3) : null);

/** Optimistic local apply for the amber/green preview. Walls are NOT re-derived
 * (the server does that on apply); unknown ids are ignored rather than thrown. */
export function applyOpsPreview(geo: PlanGeometry, entries: PendingEntry[]): PlanGeometry {
  const g: PlanGeometry = structuredClone(geo);
  for (const { pid, op } of entries) {
    switch (op.op) {
      case 'rename': {
        const r = g.rooms.find((r) => r.id === op.room_id);
        if (r) r.name = op.name;
        break;
      }
      case 'set_kind': {
        const r = g.rooms.find((r) => r.id === op.room_id);
        if (r) {
          if (op.name) r.name = op.name;
          if (op.kind) r.kind = op.kind;
          if (op.fill) r.fill = op.fill;
          r.dims = '';
        }
        break;
      }
      case 'resize_room': {
        const r = g.rooms.find((r) => r.id === op.room_id);
        if (r) {
          r.x = op.x;
          r.y = op.y;
          r.w = op.w;
          r.h = op.h;
          r.dims = '';
        }
        break;
      }
      case 'add_room':
        g.rooms.push({
          id: pvId(pid),
          name: op.name,
          kind: op.kind ?? 'room',
          dims: '',
          x: op.x,
          y: op.y,
          w: op.w,
          h: op.h,
          fill: op.fill ?? 'white',
          z: 0,
        });
        break;
      case 'split_room': {
        // mirror plan-core: shrink the host to one side of the cut, new room takes the other
        const r = g.rooms.find((r) => r.id === op.room_id);
        if (!r) break;
        const gap = op.gap ?? 0.1;
        const half = gap / 2;
        const side = op.side ?? 'high';
        let keep: [number, number, number, number];
        let created: [number, number, number, number];
        if (op.axis === 'x') {
          if (!(r.x + 0.5 < op.at && op.at < r.x + r.w - 0.5)) break;
          const low: [number, number, number, number] = [r.x, r.y, op.at - half - r.x, r.h];
          const high: [number, number, number, number] = [op.at + half, r.y, r.x + r.w - op.at - half, r.h];
          [keep, created] = side === 'low' ? [high, low] : [low, high];
        } else {
          if (!(r.y + 0.5 < op.at && op.at < r.y + r.h - 0.5)) break;
          const low: [number, number, number, number] = [r.x, r.y, r.w, op.at - half - r.y];
          const high: [number, number, number, number] = [r.x, op.at + half, r.w, r.y + r.h - op.at - half];
          [keep, created] = side === 'low' ? [high, low] : [low, high];
        }
        [r.x, r.y, r.w, r.h] = keep;
        r.dims = '';
        g.rooms.push({
          id: pvId(pid),
          name: op.new_name,
          kind: 'room',
          dims: '',
          x: created[0],
          y: created[1],
          w: created[2],
          h: created[3],
          fill: r.fill,
          z: r.z,
        });
        break;
      }
      case 'merge_rooms': {
        const r = g.rooms.find((r) => r.id === op.room_id);
        const o = g.rooms.find((r) => r.id === op.other_id);
        if (!r || !o) break;
        const x0 = Math.min(r.x, o.x);
        const y0 = Math.min(r.y, o.y);
        const x1 = Math.max(r.x + r.w, o.x + o.w);
        const y1 = Math.max(r.y + r.h, o.y + o.h);
        r.x = x0;
        r.y = y0;
        r.w = x1 - x0;
        r.h = y1 - y0;
        if (op.name) r.name = op.name;
        r.dims = '';
        g.rooms = g.rooms.filter((rm) => rm.id !== op.other_id);
        break;
      }
      case 'remove_room':
        g.rooms = g.rooms.filter((r) => r.id !== op.room_id);
        break;
      case 'add_opening': {
        const w = g.walls.find((w) => w.id === op.wall_id);
        if (w) w.openings.push({ id: pvId(pid), type: op.type, t0: op.t0, t1: op.t1 });
        break;
      }
      case 'remove_wall_chunk': {
        const w = g.walls.find((w) => w.id === op.wall_id);
        if (w) w.openings.push({ id: pvId(pid), type: 'open', t0: op.t0, t1: op.t1 });
        break;
      }
      case 'modify_opening': {
        for (const w of g.walls) {
          const o = w.openings.find((o) => o.id === op.opening_id);
          if (o) {
            if (op.t0 !== undefined) o.t0 = op.t0;
            if (op.t1 !== undefined) o.t1 = op.t1;
            if (op.type) o.type = op.type;
          }
        }
        break;
      }
      case 'remove_opening':
        for (const w of g.walls) {
          w.openings = w.openings.filter((o) => o.id !== op.opening_id);
        }
        break;
      case 'add_fixture': {
        const fx: Fixture = {
          id: pvId(pid),
          x: op.x,
          y: op.y,
          w: op.w,
          h: op.h,
          label: op.label,
        };
        g.fixtures.push(fx);
        break;
      }
      case 'modify_fixture': {
        const f = g.fixtures.find((f) => f.id === op.fixture_id);
        if (f) {
          if (op.x !== undefined) f.x = op.x;
          if (op.y !== undefined) f.y = op.y;
          if (op.w !== undefined) f.w = op.w;
          if (op.h !== undefined) f.h = op.h;
          if (op.label !== undefined) f.label = op.label;
        }
        break;
      }
      case 'remove_fixture':
        g.fixtures = g.fixtures.filter((f) => f.id !== op.fixture_id);
        break;
    }
  }
  return g;
}

/** Rewrite the pending op that created `pv-<pid>` with new geometry/name/label.
 * Returns a NEW entries array (never mutates). */
export function rewritePendingObject(
  entries: PendingEntry[],
  pvObjectId: string,
  patch: Partial<{
    x: number;
    y: number;
    w: number;
    h: number;
    name: string;
    kind: string;
    fill: 'white' | 'grey';
    label: string;
    t0: number;
    t1: number;
    type: OpeningType;
  }>,
): PendingEntry[] {
  const pid = pidOfPv(pvObjectId);
  if (!pid) return entries;
  return entries.map((e) => {
    if (e.pid !== pid) return e;
    const op = { ...e.op } as Op & Record<string, unknown>;
    if (op.op === 'add_room' || op.op === 'split_room') {
      if (op.op === 'split_room') {
        // renaming the split's new room is the only rewrite that keeps split semantics;
        // geometry tweaks convert it into what the user sees: an explicit room rect
        if (patch.name !== undefined && Object.keys(patch).length === 1) {
          return { pid, op: { ...op, new_name: patch.name } as Op };
        }
        return e;
      }
      return {
        pid,
        op: {
          ...op,
          ...(patch.x !== undefined ? { x: patch.x } : {}),
          ...(patch.y !== undefined ? { y: patch.y } : {}),
          ...(patch.w !== undefined ? { w: patch.w } : {}),
          ...(patch.h !== undefined ? { h: patch.h } : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
        } as Op,
      };
    }
    if (op.op === 'add_fixture') {
      return {
        pid,
        op: {
          ...op,
          ...(patch.x !== undefined ? { x: patch.x } : {}),
          ...(patch.y !== undefined ? { y: patch.y } : {}),
          ...(patch.w !== undefined ? { w: patch.w } : {}),
          ...(patch.h !== undefined ? { h: patch.h } : {}),
          ...(patch.label !== undefined ? { label: patch.label } : {}),
        } as Op,
      };
    }
    if (op.op === 'add_opening' || op.op === 'remove_wall_chunk') {
      // retyping an opened chunk turns it into an explicit opening op
      const base = {
        op: 'add_opening' as const,
        wall_id: (op as { wall_id: string }).wall_id,
        t0: patch.t0 ?? (op as { t0: number }).t0,
        t1: patch.t1 ?? (op as { t1: number }).t1,
        type: patch.type ?? ((op.op === 'add_opening' ? (op as { type: OpeningType }).type : 'open') as OpeningType),
      };
      return { pid, op: base };
    }
    return e;
  });
}

/** Drop the pending entry that created `pv-<pid>` (deleting an uncommitted object). */
export function removePendingObject(entries: PendingEntry[], pvObjectId: string): PendingEntry[] {
  const pid = pidOfPv(pvObjectId);
  if (!pid) return entries;
  return entries.filter((e) => e.pid !== pid);
}

/** Clamp a duplicate/paste inside the envelope: try right, left, below, above,
 * then a nudged in-place offset. Overlaps are allowed in preview (the validator
 * arbitrates on Apply) — only the envelope is enforced here. */
export function placeCopy(
  rect: { x: number; y: number; w: number; h: number },
  envelope: [number, number, number, number],
  gap = 0.15,
): { x: number; y: number } {
  const [e0, e1, e2, e3] = envelope;
  const inside = (x: number, y: number) =>
    x >= e0 - 1e-9 && y >= e1 - 1e-9 && x + rect.w <= e2 + 1e-9 && y + rect.h <= e3 + 1e-9;
  const candidates: [number, number][] = [
    [rect.x + rect.w + gap, rect.y],
    [rect.x - rect.w - gap, rect.y],
    [rect.x, rect.y + rect.h + gap],
    [rect.x, rect.y - rect.h - gap],
    [rect.x + 0.3, rect.y + 0.3],
  ];
  for (const [x, y] of candidates) {
    if (inside(snapM(x), snapM(y))) return { x: snapM(x), y: snapM(y) };
  }
  // last resort: clamp into the envelope
  return {
    x: snapM(Math.min(Math.max(rect.x, e0), e2 - rect.w)),
    y: snapM(Math.min(Math.max(rect.y, e1), e3 - rect.h)),
  };
}

/** Ops for dragging a shared wall perpendicular by d metres (Q1: rooms trade space).
 * Returns null with a reason when the wall can't move. */
export function wallMoveOps(
  geo: PlanGeometry,
  wall: Wall,
  d: number,
): { ops: Op[] } | { error: string } {
  if (wall.b === 'exterior') return { error: 'exterior walls are the envelope — immutable' };
  const a = geo.rooms.find((r) => r.id === wall.a);
  const b = geo.rooms.find((r) => r.id === wall.b);
  if (!a || !b) return { error: 'wall has no adjacent rooms' };
  const vert = wallIsVertical(wall);
  const c = vert ? wall.line[0] : wall.line[1];

  // nested room wall: resize only the nested room's facing edge
  if (a.z !== b.z) {
    const n = a.z !== 0 ? a : b;
    const minSide = 0.45;
    if (vert) {
      const isLeftEdge = Math.abs(n.x - c) < Math.abs(n.x + n.w - c);
      const nx = isLeftEdge ? n.x + d : n.x;
      const nw = isLeftEdge ? n.w - d : n.w + d;
      if (nw < minSide) return { error: `robe/pantry too small (min ${minSide}m)` };
      return { ops: [{ op: 'resize_room', room_id: n.id, x: snapM(nx), y: n.y, w: snapM(nw), h: n.h }] };
    }
    const isTopEdge = Math.abs(n.y - c) < Math.abs(n.y + n.h - c);
    const ny = isTopEdge ? n.y + d : n.y;
    const nh = isTopEdge ? n.h - d : n.h + d;
    if (nh < minSide) return { error: `robe/pantry too small (min ${minSide}m)` };
    return { ops: [{ op: 'resize_room', room_id: n.id, x: n.x, y: snapM(ny), w: n.w, h: snapM(nh) }] };
  }

  const MIN = 0.7;
  if (vert) {
    const left = a.x + a.w / 2 < c ? a : b;
    const right = left === a ? b : a;
    const lw = left.w + d;
    const rw = right.w - d;
    if (lw < MIN || rw < MIN) return { error: `rooms must stay ≥ ${MIN}m wide` };
    return {
      ops: [
        { op: 'resize_room', room_id: left.id, x: left.x, y: left.y, w: snapM(lw), h: left.h },
        { op: 'resize_room', room_id: right.id, x: snapM(right.x + d), y: right.y, w: snapM(rw), h: right.h },
      ],
    };
  }
  const top = a.y + a.h / 2 < c ? a : b;
  const bottom = top === a ? b : a;
  const th = top.h + d;
  const bh = bottom.h - d;
  if (th < MIN || bh < MIN) return { error: `rooms must stay ≥ ${MIN}m tall` };
  return {
    ops: [
      { op: 'resize_room', room_id: top.id, x: top.x, y: top.y, w: top.w, h: snapM(th) },
      { op: 'resize_room', room_id: bottom.id, x: bottom.x, y: snapM(bottom.y + d), w: bottom.w, h: snapM(bh) },
    ],
  };
}

/** Object ids touched by pending ops — drawn with the amber "uncommitted" outline. */
export function touchedIds(entries: PendingEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const { op } of entries) {
    if ('room_id' in op) ids.add(op.room_id);
    if ('other_id' in op) ids.add(op.other_id);
    if ('fixture_id' in op) ids.add(op.fixture_id);
    if ('wall_id' in op) ids.add(op.wall_id);
    if ('opening_id' in op) ids.add(op.opening_id);
  }
  return ids;
}

export function describeOp(op: Op): string {
  switch (op.op) {
    case 'rename':
      return `rename ${op.room_id} → ${op.name}`;
    case 'set_kind':
      return `${op.room_id}: ${[op.name, op.kind, op.fill].filter(Boolean).join(' · ')}`;
    case 'resize_room':
      return `resize ${op.room_id} → ${op.w.toFixed(2)} x ${op.h.toFixed(2)}m at (${op.x.toFixed(2)}, ${op.y.toFixed(2)})`;
    case 'add_room':
      return `add room ${op.name} ${op.w.toFixed(1)} x ${op.h.toFixed(1)}m`;
    case 'split_room':
      return `add wall across ${op.room_id} (${op.axis} at ${op.at.toFixed(2)}) → ${op.new_name}`;
    case 'merge_rooms':
      return `merge ${op.other_id} into ${op.room_id}`;
    case 'remove_room':
      return `remove room ${op.room_id}`;
    case 'add_opening':
      return `add ${op.type} on ${op.wall_id.replace('w:', '')}`;
    case 'modify_opening':
      return `adjust opening ${op.opening_id}`;
    case 'remove_opening':
      return `remove opening ${op.opening_id}`;
    case 'remove_wall_chunk':
      return `open wall chunk ${op.wall_id.replace('w:', '')} ${op.t0.toFixed(2)}–${op.t1.toFixed(2)}`;
    case 'add_fixture':
      return `add fixture ${op.label || 'unit'} ${op.w.toFixed(1)} x ${op.h.toFixed(1)}m`;
    case 'modify_fixture':
      return `adjust fixture ${op.fixture_id.replace('fx:', '')}`;
    case 'remove_fixture':
      return `remove fixture ${op.fixture_id.replace('fx:', '')}`;
  }
}

export function describeOps(ops: Op[]): string {
  const text = ops.map(describeOp).join('; ');
  return text.length > 110 ? `${text.slice(0, 107)}…` : text || 'Manual geometry edit';
}

/** A room-like or fixture-like object from preview geometry that is still pending. */
export const isPendingId = (id: string): boolean => id.startsWith('pv-');
