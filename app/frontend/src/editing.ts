// The human editing pipeline: canvas/inspector intents compile to the SAME typed
// ops the agent emits (plan_core.ops). Pending ops preview locally (walls are NOT
// re-derived — that happens server-side on apply) and commit as one version.

import type { Fixture, OpeningType, PlanGeometry } from './types';

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

/** Optimistic local apply for the amber preview. Walls stay as-is (the server
 * re-derives them); unknown ids are ignored rather than thrown. */
export function applyOpsPreview(geo: PlanGeometry, ops: Op[]): PlanGeometry {
  const g: PlanGeometry = structuredClone(geo);
  let pv = 0;
  for (const op of ops) {
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
          id: `pv-room${++pv}`,
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
      case 'remove_room':
        g.rooms = g.rooms.filter((r) => r.id !== op.room_id);
        break;
      case 'add_opening': {
        const w = g.walls.find((w) => w.id === op.wall_id);
        if (w) w.openings.push({ id: `pv-o${++pv}`, type: op.type, t0: op.t0, t1: op.t1 });
        break;
      }
      case 'remove_wall_chunk': {
        const w = g.walls.find((w) => w.id === op.wall_id);
        if (w) w.openings.push({ id: `pv-o${++pv}`, type: 'open', t0: op.t0, t1: op.t1 });
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
          id: `pv-fx${++pv}`,
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

/** Object ids touched by pending ops — drawn with the amber "uncommitted" outline. */
export function touchedIds(ops: Op[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) {
    if ('room_id' in op) ids.add(op.room_id);
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
