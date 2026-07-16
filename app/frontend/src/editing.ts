// The human editing pipeline: canvas/inspector intents compile to the SAME typed
// ops the agent emits (plan_core.ops). Ops queue as PendingEntry objects keyed by
// a client id; objects created by a pending op preview with the id `pv-<pid>` and
// are FIRST-CLASS EDITABLE — editing a pending object rewrites its op in place, so
// no preview id ever reaches the server. One Apply commits the batch as one version.

import type { Fixture, OpeningType, PlanGeometry, Room, Wall } from './types';
import {
  DEFAULT_LEVEL,
  deriveWalls,
  locateWall,
  snapM,
  tToAbs,
  wallCoord,
  wallIsVertical,
} from './geometry';

// An existing opening captured by absolute position (not wall id), so it can be re-homed
// onto the re-derived walls the way the server (plan_core.ops.apply_ops) does. `level` is
// the host structure — an opening only re-homes onto same-level walls.
interface AbsOpening {
  vertical: boolean;
  coord: number;
  lo: number;
  hi: number;
  type: OpeningType;
  id: string;
  level: string;
}

function snapshotOpenings(walls: Wall[], roomLevel: Map<string, string>): AbsOpening[] {
  const out: AbsOpening[] = [];
  for (const w of walls) {
    for (const o of w.openings) {
      out.push({
        vertical: wallIsVertical(w),
        coord: wallCoord(w),
        lo: tToAbs(w, o.t0),
        hi: tToAbs(w, o.t1),
        type: o.type,
        id: o.id,
        level: roomLevel.get(w.a) ?? DEFAULT_LEVEL,
      });
    }
  }
  return out;
}

function rehomeOpenings(walls: Wall[], snapshot: AbsOpening[], roomLevel: Map<string, string>): void {
  // scope per level like the server (plan_core.ops): detached structures share a coord
  // origin, so an opening must never re-home onto a different level's wall
  const wallsByLevel = new Map<string, Wall[]>();
  for (const w of walls) {
    const lv = roomLevel.get(w.a) ?? DEFAULT_LEVEL;
    const arr = wallsByLevel.get(lv);
    if (arr) arr.push(w);
    else wallsByLevel.set(lv, [w]);
  }
  for (const a of snapshot) {
    const hit = locateWall(wallsByLevel.get(a.level) ?? [], a.vertical, a.coord, a.lo, a.hi);
    if (!hit) continue;
    if (hit.wall.openings.some((o) => o.id === a.id)) continue;
    hit.wall.openings.push({ id: a.id, type: a.type, t0: hit.t0, t1: hit.t1 });
  }
}

// ops that change room rectangles → walls must be re-derived so the preview shows them moved
const ROOM_GEOMETRY_OPS = new Set(['add_room', 'split_room', 'merge_rooms', 'remove_room', 'resize_room']);

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
      level?: string;
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
  | { op: 'add_fixture'; x: number; y: number; w: number; h: number; label: string; level?: string }
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

/** Optimistic local apply for the amber/green preview. Walls ARE re-derived when a room
 * rectangle changes (so a moved/added wall previews in its new spot, matching what the
 * server will commit); unknown ids are ignored rather than thrown. */
export function applyOpsPreview(geo: PlanGeometry, entries: PendingEntry[]): PlanGeometry {
  const g: PlanGeometry = structuredClone(geo);
  // opening ops run in a second pass (after walls are re-derived) so they land on the walls
  // the user sees — a room move/swap in the same batch renames the walls they sit on.
  const openingEntries = entries.filter((e) =>
    ['add_opening', 'remove_wall_chunk', 'modify_opening', 'remove_opening'].includes(e.op.op),
  );
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
          level: op.level ?? 'level-1',
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
          level: r.level,
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
      // opening ops handled in the second pass below
      case 'add_opening':
      case 'remove_wall_chunk':
      case 'modify_opening':
      case 'remove_opening':
        break;
      case 'add_fixture': {
        const fx: Fixture = {
          id: pvId(pid),
          x: op.x,
          y: op.y,
          w: op.w,
          h: op.h,
          label: op.label,
          level: op.level ?? 'level-1',
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
  // Openings mirror plan_core.ops.apply_ops. When a room op changes geometry the walls are
  // re-derived, so existing openings are re-homed by ABSOLUTE POSITION (like the server), not
  // carried by wall id — a swap or other topology-changing edit renames walls, and carry-by-id
  // would silently drop the door even though the server keeps it. A modify_opening resolves its
  // t0/t1 against the ORIGINAL host wall (before re-derivation) exactly like the server's
  // geo.opening(), so a room op that resizes that host wall in the same batch can't shift it.
  if (entries.some((e) => ROOM_GEOMETRY_OPS.has(e.op.op))) {
    // level per room: original rooms for the snapshot (old walls may host a removed room),
    // mutated rooms for the re-derived walls
    const snapLevel = new Map(geo.rooms.map((r) => [r.id, r.level ?? DEFAULT_LEVEL]));
    let snapshot = snapshotOpenings(g.walls, snapLevel);
    // modify_opening / remove_opening act on the abs snapshot BEFORE re-derivation — modify
    // against the ORIGINAL host wall's span, so re-homing lands it where the server commits.
    for (const { op } of openingEntries) {
      if (op.op === 'modify_opening') {
        const a = snapshot.find((s) => s.id === op.opening_id);
        const host = g.walls.find((w) => w.openings.some((o) => o.id === op.opening_id));
        if (a && host) {
          if (op.t0 !== undefined) a.lo = tToAbs(host, op.t0);
          if (op.t1 !== undefined) a.hi = tToAbs(host, op.t1);
          if (op.type) a.type = op.type;
        }
      } else if (op.op === 'remove_opening') {
        snapshot = snapshot.filter((s) => s.id !== op.opening_id);
      }
    }
    g.walls = deriveWalls(g.rooms);
    const finalLevel = new Map(g.rooms.map((r) => [r.id, r.level ?? DEFAULT_LEVEL]));
    rehomeOpenings(g.walls, snapshot, finalLevel);
    // add_opening / remove_wall_chunk resolve against the re-derived walls (their ids are only
    // correct here — a room move in the same batch renames the wall the user clicked).
    for (const { pid, op } of openingEntries) {
      if (op.op === 'add_opening') {
        const w = g.walls.find((w) => w.id === op.wall_id);
        if (w) w.openings.push({ id: pvId(pid), type: op.type, t0: op.t0, t1: op.t1 });
      } else if (op.op === 'remove_wall_chunk') {
        const w = g.walls.find((w) => w.id === op.wall_id);
        if (w) w.openings.push({ id: pvId(pid), type: 'open', t0: op.t0, t1: op.t1 });
      }
    }
  } else {
    // walls unchanged: apply opening ops in place (matches the server — no wall length changes,
    // so t0/t1 map to the same absolute span the server re-homes onto).
    for (const { pid, op } of openingEntries) {
      switch (op.op) {
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
      }
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

// --- reflow-on-edit: dragging (move) or resizing a room pushes/pulls its direct
// neighbours so the plan stays tiled (leading-edge rooms shrink, trailing-edge rooms
// grow), rather than overlapping + leaving a gap. Each moved edge carries the neighbour
// on it, like the wall-drag "trade space" idea. Hold Alt to bypass and edit freely.
const REFLOW_ADJ = 0.35; // edges within this gap count as a shared wall (walls.py GAP_TOL)
const REFLOW_MIN_SPAN = 0.3; // perpendicular overlap needed to count as a neighbour
const reflowMinSide = (r: Room): number => (r.kind === 'storage' ? 0.45 : 0.7);

interface EdgeNeighbours {
  left: Room[];
  right: Room[];
  top: Room[];
  bottom: Room[];
}

function edgeNeighbours(geo: PlanGeometry, room: Room): EdgeNeighbours {
  const level = room.level ?? 'level-1';
  const rx2 = room.x + room.w;
  const ry2 = room.y + room.h;
  const cells = geo.rooms.filter(
    (r) => r.z === 0 && r.id !== room.id && !isPendingId(r.id) && (r.level ?? 'level-1') === level,
  );
  const xOverlap = (n: Room) => Math.min(n.x + n.w, rx2) - Math.max(n.x, room.x);
  const yOverlap = (n: Room) => Math.min(n.y + n.h, ry2) - Math.max(n.y, room.y);
  return {
    top: cells.filter((n) => Math.abs(n.y + n.h - room.y) <= REFLOW_ADJ && xOverlap(n) >= REFLOW_MIN_SPAN),
    bottom: cells.filter((n) => Math.abs(n.y - ry2) <= REFLOW_ADJ && xOverlap(n) >= REFLOW_MIN_SPAN),
    left: cells.filter((n) => Math.abs(n.x + n.w - room.x) <= REFLOW_ADJ && yOverlap(n) >= REFLOW_MIN_SPAN),
    right: cells.filter((n) => Math.abs(n.x - rx2) <= REFLOW_ADJ && yOverlap(n) >= REFLOW_MIN_SPAN),
  };
}

/** Build resize ops for the room and its neighbours given how far each of the room's
 * four edges moved (already clamped). A corner room may touch two edges. */
function buildReflowOps(
  room: Room,
  s: EdgeNeighbours,
  dLeft: number,
  dRight: number,
  dTop: number,
  dBottom: number,
): Op[] {
  if (Math.abs(dLeft) + Math.abs(dRight) + Math.abs(dTop) + Math.abs(dBottom) < 1e-9) return [];
  const adj = new Map<string, { x: number; y: number; w: number; h: number }>();
  const at = (n: Room) => {
    let r = adj.get(n.id);
    if (!r) {
      r = { x: n.x, y: n.y, w: n.w, h: n.h };
      adj.set(n.id, r);
    }
    return r;
  };
  if (Math.abs(dLeft) > 1e-9) for (const n of s.left) at(n).w = n.w + dLeft;
  if (Math.abs(dRight) > 1e-9)
    for (const n of s.right) {
      const r = at(n);
      r.x = n.x + dRight;
      r.w = n.w - dRight;
    }
  if (Math.abs(dTop) > 1e-9) for (const n of s.top) at(n).h = n.h + dTop;
  if (Math.abs(dBottom) > 1e-9)
    for (const n of s.bottom) {
      const r = at(n);
      r.y = n.y + dBottom;
      r.h = n.h - dBottom;
    }
  const ops: Op[] = [
    {
      op: 'resize_room',
      room_id: room.id,
      x: snapM(room.x + dLeft),
      y: snapM(room.y + dTop),
      w: snapM(room.w + dRight - dLeft),
      h: snapM(room.h + dBottom - dTop),
    },
  ];
  for (const [id, r] of adj) {
    ops.push({ op: 'resize_room', room_id: id, x: snapM(r.x), y: snapM(r.y), w: snapM(r.w), h: snapM(r.h) });
  }
  return ops;
}

/** Move a room: all four edges shift by (dx,dy); neighbours trade space. */
export function roomMoveOps(geo: PlanGeometry, room: Room, dx: number, dy: number): Op[] {
  const s = edgeNeighbours(geo, room);
  // clamp the move so a shrinking (leading-edge) neighbour never drops below its min
  if (dy < 0) for (const n of s.top) dy = Math.max(dy, reflowMinSide(n) - n.h);
  if (dy > 0) for (const n of s.bottom) dy = Math.min(dy, n.h - reflowMinSide(n));
  if (dx < 0) for (const n of s.left) dx = Math.max(dx, reflowMinSide(n) - n.w);
  if (dx > 0) for (const n of s.right) dx = Math.min(dx, n.w - reflowMinSide(n));
  dx = snapM(dx);
  dy = snapM(dy);
  return buildReflowOps(room, s, dx, dx, dy, dy);
}

/** Resize a room from its bottom-right corner (top-left anchored): only the right and
 * bottom edges move by (dw,dh), so right/bottom neighbours trade space. */
export function roomResizeOps(geo: PlanGeometry, room: Room, dw: number, dh: number): Op[] {
  const s = edgeNeighbours(geo, room);
  // growing into a neighbour shrinks it — clamp so it stays >= its min side
  if (dw > 0) for (const n of s.right) dw = Math.min(dw, n.w - reflowMinSide(n));
  if (dh > 0) for (const n of s.bottom) dh = Math.min(dh, n.h - reflowMinSide(n));
  return buildReflowOps(room, s, 0, snapM(dw), 0, snapM(dh));
}

// A room and its neighbour count as the same "column"/"row" (a clean stack) when their
// perpendicular extents line up — only then can they swap without disturbing anything else.
const sameColumn = (a: Room, b: Room) =>
  Math.abs(a.x - b.x) <= REFLOW_ADJ && Math.abs(a.x + a.w - (b.x + b.w)) <= REFLOW_ADJ;
const sameRow = (a: Room, b: Room) =>
  Math.abs(a.y - b.y) <= REFLOW_ADJ && Math.abs(a.y + a.h - (b.y + b.h)) <= REFLOW_ADJ;

function swapVertical(room: Room, dy: number, s: EdgeNeighbours): Op[] | null {
  const up = dy < 0;
  const cands = up ? s.top : s.bottom;
  if (cands.length !== 1 || !sameColumn(cands[0], room)) return null;
  const n = cands[0];
  const nMid = n.y + n.h / 2;
  // swap once the dragged room's leading edge passes the neighbour's midpoint
  const leadNew = up ? room.y + dy : room.y + room.h + dy;
  if (up ? leadNew >= nMid : leadNew <= nMid) return null;
  if (up) {
    const gap = room.y - (n.y + n.h); // preserve the wall gap between them
    return [
      { op: 'resize_room', room_id: room.id, x: room.x, y: snapM(n.y), w: room.w, h: room.h },
      { op: 'resize_room', room_id: n.id, x: n.x, y: snapM(n.y + room.h + gap), w: n.w, h: n.h },
    ];
  }
  const gap = n.y - (room.y + room.h);
  return [
    { op: 'resize_room', room_id: n.id, x: n.x, y: room.y, w: n.w, h: n.h },
    { op: 'resize_room', room_id: room.id, x: room.x, y: snapM(room.y + n.h + gap), w: room.w, h: room.h },
  ];
}

function swapHorizontal(room: Room, dx: number, s: EdgeNeighbours): Op[] | null {
  const leftward = dx < 0;
  const cands = leftward ? s.left : s.right;
  if (cands.length !== 1 || !sameRow(cands[0], room)) return null;
  const n = cands[0];
  const nMid = n.x + n.w / 2;
  const leadNew = leftward ? room.x + dx : room.x + room.w + dx;
  if (leftward ? leadNew >= nMid : leadNew <= nMid) return null;
  if (leftward) {
    const gap = room.x - (n.x + n.w);
    return [
      { op: 'resize_room', room_id: room.id, x: snapM(n.x), y: room.y, w: room.w, h: room.h },
      { op: 'resize_room', room_id: n.id, x: snapM(n.x + room.w + gap), y: n.y, w: n.w, h: n.h },
    ];
  }
  const gap = n.x - (room.x + room.w);
  return [
    { op: 'resize_room', room_id: n.id, x: room.x, y: n.y, w: n.w, h: n.h },
    { op: 'resize_room', room_id: room.id, x: snapM(room.x + n.w + gap), y: room.y, w: room.w, h: room.h },
  ];
}

/** Drop a dragged room: if it was dragged PAST a single aligned neighbour, swap the two
 * (both keep their size, everything else stays put); otherwise reflow (trade space). */
export function roomDropOps(geo: PlanGeometry, room: Room, dx: number, dy: number): Op[] {
  const s = edgeNeighbours(geo, room);
  const swap =
    Math.abs(dy) >= Math.abs(dx) ? swapVertical(room, dy, s) : swapHorizontal(room, dx, s);
  return swap ?? roomMoveOps(geo, room, dx, dy);
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
