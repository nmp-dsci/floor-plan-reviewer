// The plan-canvas parity registry — the SINGLE source of truth for the Feature
// Checks tab. Every canvas capability is one entry: how the human does it, how
// the AI does it, and (for op/contract rows) an automated check that runs against
// a throwaway sandbox review through the same /edits pipeline both authors use.
// Gesture rows are covered by the Playwright e2e matrix (make -C app e2e).

import { api } from './api';
import type { Op, PendingEntry } from './editing';
import { applyOpsPreview, placeCopy, wallMoveOps } from './editing';
import { clearSize } from './geometry';
import type { PlanGeometry } from './types';

export interface CheckCtx {
  reviewId: string;
  head: () => Promise<{ n: number; geometry: PlanGeometry }>;
  edits: (ops: Op[], title: string) => Promise<{ n: number; warnings: string[] }>;
  editsExpectError: (ops: Op[], status: number) => Promise<void>;
}

export interface FeatureDef {
  id: string;
  group: string;
  feature: string;
  human: string;
  ai: string;
  example: string;
  kind: 'op' | 'gesture' | 'contract';
  check?: (ctx: CheckCtx) => Promise<void>;
}

const expect = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const entries = (ops: Op[]): PendingEntry[] => ops.map((op, i) => ({ pid: `t${i}`, op }));

/** preview == server result is the human/AI parity guarantee. */
async function applyAndCompare(
  ctx: CheckCtx,
  ops: Op[],
  title: string,
  compare: (preview: PlanGeometry, applied: PlanGeometry) => void,
): Promise<void> {
  const before = await ctx.head();
  const preview = applyOpsPreview(before.geometry, entries(ops));
  await ctx.edits(ops, title);
  const after = await ctx.head();
  compare(preview, after.geometry);
}

export const FEATURES: FeatureDef[] = [
  // ---------- rooms ----------
  {
    id: 'room-select',
    group: 'Rooms',
    feature: 'Select / multi-select',
    human: 'Click a room; shift-click or long-press for multi; Esc clears',
    ai: 'Comment targets carry room ids',
    example: 'click BED 3 → red dashed selection',
    kind: 'gesture',
  },
  {
    id: 'room-rename',
    group: 'Rooms',
    feature: 'Rename',
    human: 'Select → Name field is auto-focused → type + Enter',
    ai: 'rename / set_kind(name)',
    example: 'rename bed-3 → GUEST SUITE',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const room = geometry.rooms.find((r) => r.z === 0 && r.fill !== 'grey');
      expect(Boolean(room), 'no room to rename');
      await applyAndCompare(
        ctx,
        [{ op: 'rename', room_id: room!.id, name: 'PARITY TEST' }],
        'check: rename',
        (p, a) => {
          expect(a.rooms.find((r) => r.id === room!.id)?.name === 'PARITY TEST', 'server name mismatch');
          expect(p.rooms.find((r) => r.id === room!.id)?.name === 'PARITY TEST', 'preview name mismatch');
        },
      );
    },
    kind: 'op',
  },
  {
    id: 'room-kind',
    group: 'Rooms',
    feature: 'Change kind / fill',
    human: 'Inspector Kind + Fill selects',
    ai: 'set_kind',
    example: 'store → study, fill white',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const room = geometry.rooms.find((r) => r.z === 0);
      await applyAndCompare(
        ctx,
        [{ op: 'set_kind', room_id: room!.id, kind: 'room', fill: 'white' }],
        'check: set_kind',
        (_p, a) => {
          const r = a.rooms.find((r) => r.id === room!.id)!;
          expect(r.kind === 'room' && r.fill === 'white', 'kind/fill not applied');
        },
      );
    },
    kind: 'op',
  },
  {
    id: 'room-move-resize',
    group: 'Rooms',
    feature: 'Move / resize',
    human: 'Drag the body (0.05m snap) or corner handle; numeric x/y/w/h fields',
    ai: 'resize_room',
    example: 'shrink a bedroom 0.2m',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const room = geometry.rooms.find((r) => r.z === 0 && r.w > 2 && r.h > 2)!;
      const ops: Op[] = [
        { op: 'resize_room', room_id: room.id, x: room.x, y: room.y, w: room.w - 0.1, h: room.h },
      ];
      await applyAndCompare(ctx, ops, 'check: resize', (p, a) => {
        const pa = p.rooms.find((r) => r.id === room.id)!;
        const aa = a.rooms.find((r) => r.id === room.id)!;
        expect(Math.abs(aa.w - (room.w - 0.1)) < 1e-6, 'server rect mismatch');
        expect(Math.abs(pa.w - aa.w) < 1e-6, 'preview/server parity broken');
      });
    },
    kind: 'op',
  },
  {
    id: 'room-add',
    group: 'Rooms',
    feature: 'Add room',
    human: '+ Room → drag out the space → name it (field auto-focused)',
    ai: 'add_room',
    example: 'butlers pantry 1.5×2.0m in free space',
    check: async (ctx) => {
      // find free space: use the envelope edge next to the smallest room... simplest:
      // shrink a big room, add into the freed strip (the butler's-pantry move)
      const { geometry } = await ctx.head();
      const host = [...geometry.rooms].filter((r) => r.z === 0 && r.w >= 3).sort((a, b) => b.w - a.w)[0]!;
      const ops: Op[] = [
        { op: 'resize_room', room_id: host.id, x: host.x, y: host.y, w: host.w - 1.2, h: host.h },
        {
          op: 'add_room',
          name: 'CHECK PANTRY',
          kind: 'storage',
          x: host.x + host.w - 1.1,
          y: host.y,
          w: 1.0,
          h: Math.min(host.h, 2.0),
          fill: 'grey',
        },
      ];
      await applyAndCompare(ctx, ops, 'check: add_room', (_p, a) => {
        expect(
          a.rooms.some((r) => r.name === 'CHECK PANTRY'),
          'added room missing after apply',
        );
      });
    },
    kind: 'op',
  },
  {
    id: 'room-duplicate',
    group: 'Rooms',
    feature: 'Duplicate',
    human: 'Duplicate button or ⌘C/⌘V — copy clamps inside the envelope, editable before Apply',
    ai: 'add_room with the copied rect',
    example: 'copy of BED 3 lands inside the envelope',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const env = geometry.meta.envelope as [number, number, number, number];
      const room = geometry.rooms.find((r) => r.z === 0)!;
      const at = placeCopy(room, env);
      expect(at.x >= env[0] - 1e-9 && at.x + room.w <= env[2] + 1e-9, 'copy x escapes envelope');
      expect(at.y >= env[1] - 1e-9 && at.y + room.h <= env[3] + 1e-9, 'copy y escapes envelope');
    },
    kind: 'op',
  },
  {
    id: 'room-remove',
    group: 'Rooms',
    feature: 'Remove',
    human: 'Delete key or Remove room button',
    ai: 'remove_room',
    example: 'delete the check-pantry',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const target = geometry.rooms.find((r) => r.name === 'CHECK PANTRY');
      if (!target) return; // depends on room-add having run; skip silently otherwise
      await applyAndCompare(ctx, [{ op: 'remove_room', room_id: target.id }], 'check: remove', (_p, a) => {
        expect(!a.rooms.some((r) => r.id === target.id), 'room still present');
      });
    },
    kind: 'op',
  },
  {
    id: 'room-split',
    group: 'Rooms',
    feature: 'Add a wall (split)',
    human: '+ Wall → drag a line across a room → new room auto-selected for naming',
    ai: 'split_room (axis, at)',
    example: 'split the largest room in half',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const host = [...geometry.rooms]
        .filter((r) => r.z === 0 && r.h >= 2.4 && r.w >= 1.5)
        .sort((a, b) => b.w * b.h - a.w * a.h)[0];
      expect(Boolean(host), 'no room tall enough to split');
      const before = (await ctx.head()).geometry.rooms.length;
      await ctx.edits(
        [
          {
            op: 'split_room',
            room_id: host.id,
            axis: 'y',
            at: host.y + host.h / 2,
            new_name: 'CHECK SPLIT',
          },
        ],
        'check: split_room',
      );
      const after = await ctx.head();
      expect(after.geometry.rooms.length === before + 1, 'split did not create a room');
      expect(after.geometry.rooms.some((r) => r.name === 'CHECK SPLIT'), 'split room missing');
    },
    kind: 'op',
  },
  {
    id: 'room-merge',
    group: 'Rooms',
    feature: 'Merge two rooms',
    human: 'Multi-select exactly 2 → Merge rooms button',
    ai: 'merge_rooms',
    example: 'merge the split halves back',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const split = geometry.rooms.find((r) => r.name === 'CHECK SPLIT');
      if (!split) return;
      // its host is the room sharing x/w directly above or below
      const host = geometry.rooms.find(
        (r) =>
          r.id !== split.id &&
          r.z === 0 &&
          Math.abs(r.x - split.x) < 0.1 &&
          Math.abs(r.w - split.w) < 0.1 &&
          (Math.abs(r.y + r.h - split.y) < 0.3 || Math.abs(split.y + split.h - r.y) < 0.3),
      );
      if (!host) return;
      await ctx.edits(
        [{ op: 'merge_rooms', room_id: host.id, other_id: split.id }],
        'check: merge_rooms',
      );
      const after = await ctx.head();
      expect(!after.geometry.rooms.some((r) => r.id === split.id), 'merged room still present');
    },
    kind: 'op',
  },
  // ---------- walls & openings ----------
  {
    id: 'wall-select-side',
    group: 'Walls & openings',
    feature: 'Select wall / side',
    human: 'Click picks the solid segment between openings',
    ai: 'Wall ids in comment targets',
    example: 'bath↔hall wall → 0.4m side beside the door',
    kind: 'gesture',
  },
  {
    id: 'wall-span',
    group: 'Walls & openings',
    feature: 'Pick a span',
    human: 'Drag the dashed handles (selection only — relabelled “span”)',
    ai: 't0/t1 fractions in targets',
    example: '1.3m span of a 3m wall',
    kind: 'gesture',
  },
  {
    id: 'wall-move',
    group: 'Walls & openings',
    feature: 'Move a wall',
    human: 'Drag the selected wall sideways — both rooms trade space (Q1)',
    ai: 'resize_room on both neighbours',
    example: 'shift an interior wall +0.2m',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const wall = geometry.walls.find((w) => {
        if (w.b === 'exterior') return false;
        const a = geometry.rooms.find((r) => r.id === w.a);
        const b = geometry.rooms.find((r) => r.id === w.b);
        return Boolean(a && b && a.z === 0 && b.z === 0 && a.w > 1.2 && b.w > 1.2 && a.h > 1.2 && b.h > 1.2);
      });
      expect(Boolean(wall), 'no interior wall between two z0 rooms');
      const res = wallMoveOps(geometry, wall!, 0.1);
      expect(!('error' in res), `wallMoveOps refused: ${'error' in res ? res.error : ''}`);
      if ('error' in res) return;
      const a0 = geometry.rooms.find((r) => r.id === wall!.a)!;
      const b0 = geometry.rooms.find((r) => r.id === wall!.b)!;
      const area0 = a0.w * a0.h + b0.w * b0.h;
      await ctx.edits(res.ops, 'check: wall move');
      const after = await ctx.head();
      const a1 = after.geometry.rooms.find((r) => r.id === wall!.a)!;
      const b1 = after.geometry.rooms.find((r) => r.id === wall!.b)!;
      expect(Math.abs(a1.w * a1.h + b1.w * b1.h - area0) < 0.4, 'area not conserved by wall move');
      // exterior walls must refuse
      const ext = geometry.walls.find((w) => w.b === 'exterior')!;
      const refuse = wallMoveOps(geometry, ext, 0.2);
      expect('error' in refuse, 'exterior wall move was not refused');
    },
    kind: 'op',
  },
  {
    id: 'wall-open-chunk',
    group: 'Walls & openings',
    feature: 'Open a wall span',
    human: 'Select side/span → “Open this span”',
    ai: 'remove_wall_chunk',
    example: 'servery opening between kitchen and living',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const wall = geometry.walls.find((w) => w.b !== 'exterior' && w.openings.length === 0 && (w.line[0] !== w.line[2] ? Math.abs(w.line[2] - w.line[0]) : Math.abs(w.line[3] - w.line[1])) > 1.5)!;
      const before = geometry.walls.reduce((n, w) => n + w.openings.length, 0);
      await ctx.edits(
        [{ op: 'remove_wall_chunk', wall_id: wall.id, t0: 0.3, t1: 0.6 }],
        'check: open chunk',
      );
      const after = await ctx.head();
      const count = after.geometry.walls.reduce((n, w) => n + w.openings.length, 0);
      expect(count === before + 1, 'open span did not appear');
    },
    kind: 'op',
  },
  {
    id: 'opening-add',
    group: 'Walls & openings',
    feature: 'Add opening',
    human: '+ Opening → click a wall (0.9m door); or +door/+window on a selection',
    ai: 'add_opening (door/window/open)',
    example: 'door at the middle of a wall',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const wall = geometry.walls.find((w) => w.openings.length === 0)!;
      await ctx.edits(
        [{ op: 'add_opening', wall_id: wall.id, t0: 0.35, t1: 0.65, type: 'door' }],
        'check: add opening',
      );
      const after = await ctx.head();
      const w2 = after.geometry.walls.find((w) => w.id === wall.id);
      expect(Boolean(w2 && w2.openings.length >= 1), 'opening missing after apply');
    },
    kind: 'op',
  },
  {
    id: 'opening-modify',
    group: 'Walls & openings',
    feature: 'Move / retype / remove opening',
    human: 'Drag end handles · door/window/open toggle · Delete',
    ai: 'modify_opening / remove_opening',
    example: 'door → window, then remove',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      let target: { id: string } | undefined;
      for (const w of geometry.walls) for (const o of w.openings) target ??= o;
      expect(Boolean(target), 'no opening to modify');
      await ctx.edits(
        [{ op: 'modify_opening', opening_id: target!.id, type: 'window' }],
        'check: retype opening',
      );
      const after = await ctx.head();
      let found: { type: string } | undefined;
      for (const w of after.geometry.walls)
        for (const o of w.openings) if (o.id === target!.id) found = o;
      expect(found?.type === 'window', 'opening type not changed');
    },
    kind: 'op',
  },
  {
    id: 'opening-copy',
    group: 'Walls & openings',
    feature: 'Copy opening',
    human: '⌘C/⌘V or Duplicate — pastes along the same wall',
    ai: 'add_opening beside the source',
    example: 'second door on the same wall',
    kind: 'gesture',
  },
  // ---------- fixtures ----------
  {
    id: 'fixture-add-label',
    group: 'Fixtures',
    feature: 'Add + label',
    human: '+ Fixture → draw — Label field opens focused; Enter saves',
    ai: 'add_fixture / modify_fixture(label)',
    example: 'island bench 2.0×0.9m',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const host = geometry.rooms.find((r) => r.z === 0 && r.w > 2.5 && r.h > 2.5)!;
      await ctx.edits(
        [
          {
            op: 'add_fixture',
            x: host.x + 0.4,
            y: host.y + 0.4,
            w: 1.2,
            h: 0.6,
            label: 'CHECK BENCH',
          },
        ],
        'check: add fixture',
      );
      const after = await ctx.head();
      const fx = after.geometry.fixtures.find((f) => f.label === 'CHECK BENCH');
      expect(Boolean(fx), 'fixture missing');
      expect(Boolean(fx!.id && fx!.id.length > 2), 'fixture id missing');
    },
    kind: 'op',
  },
  {
    id: 'fixture-modify',
    group: 'Fixtures',
    feature: 'Move / resize / relabel',
    human: 'Drag body / corner handle · Label + Enter (incl. pending)',
    ai: 'modify_fixture',
    example: 'stretch the bench to 1.8m',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const fx = geometry.fixtures.find((f) => f.label === 'CHECK BENCH') ?? geometry.fixtures[0];
      expect(Boolean(fx), 'no fixture to modify');
      await applyAndCompare(
        ctx,
        [{ op: 'modify_fixture', fixture_id: fx!.id, w: 1.8, label: 'CHECK BENCH XL' }],
        'check: modify fixture',
        (p, a) => {
          const pa = p.fixtures.find((f) => f.id === fx!.id)!;
          const aa = a.fixtures.find((f) => f.id === fx!.id)!;
          expect(Math.abs(aa.w - 1.8) < 1e-6 && aa.label === 'CHECK BENCH XL', 'modify not applied');
          expect(Math.abs(pa.w - aa.w) < 1e-6, 'preview/server parity broken');
        },
      );
    },
    kind: 'op',
  },
  {
    id: 'fixture-dup-remove',
    group: 'Fixtures',
    feature: 'Duplicate / remove',
    human: 'Duplicate button or ⌘C/⌘V · Delete key',
    ai: 'add_fixture copy / remove_fixture by id',
    example: 'copy then delete the bench',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const fx = geometry.fixtures.find((f) => f.label.startsWith('CHECK BENCH'));
      if (!fx) return;
      await ctx.edits([{ op: 'remove_fixture', fixture_id: fx.id }], 'check: remove fixture');
      const after = await ctx.head();
      expect(!after.geometry.fixtures.some((f) => f.id === fx.id), 'fixture still present');
    },
    kind: 'op',
  },
  // ---------- space, batch & versions ----------
  {
    id: 'batch-apply',
    group: 'Space, batch & versions',
    feature: 'Batch preview + apply',
    human: 'Edits stack (amber/green preview) → one Apply = one version; pending objects stay editable',
    ai: 'One comment batch = one version',
    example: 'rename + resize in a single v-bump',
    check: async (ctx) => {
      const h0 = await ctx.head();
      const room = h0.geometry.rooms.find((r) => r.z === 0)!;
      await ctx.edits(
        [
          { op: 'rename', room_id: room.id, name: 'BATCH A' },
          { op: 'resize_room', room_id: room.id, x: room.x, y: room.y, w: room.w, h: room.h },
        ],
        'check: batch',
      );
      const h1 = await ctx.head();
      expect(h1.n === h0.n + 1, 'batch did not produce exactly one version');
    },
    kind: 'op',
  },
  {
    id: 'undo-versions',
    group: 'Space, batch & versions',
    feature: 'Undo / delete version / bookmark',
    human: '⌘Z pops pending, then rolls back head; delete vNN; ★ survives pruning',
    ai: 'Same version API',
    example: 'undo the batch version',
    check: async (ctx) => {
      const h = await ctx.head();
      if (h.n === 0) return;
      await api.deleteVersion(ctx.reviewId, h.n);
      const h2 = await ctx.head();
      expect(h2.n < h.n, 'rollback did not lower head');
    },
    kind: 'op',
  },
  // ---------- contracts ----------
  {
    id: 'contract-dims',
    group: 'Contracts',
    feature: 'Dims always visible (clear size)',
    human: 'Every room label shows clear size at every zoom',
    ai: 'Register/export use the same clear numbers',
    example: 'clear < rect for every room',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      for (const r of geometry.rooms) {
        const c = clearSize(r, geometry.walls);
        expect(c.w > 0 && c.h > 0, `${r.id} clear size not positive`);
        expect(c.w <= r.w + 1e-9 && c.h <= r.h + 1e-9, `${r.id} clear exceeds rect`);
      }
    },
    kind: 'contract',
  },
  {
    id: 'contract-envelope',
    group: 'Contracts',
    feature: 'Envelope + footprint immutable',
    human: 'Oversize edits rejected inline',
    ai: 'Validator bounces the agent identically',
    example: 'resize past the boundary → 422',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const env = geometry.meta.envelope as [number, number, number, number];
      const room = geometry.rooms.find((r) => r.z === 0)!;
      await ctx.editsExpectError(
        [
          {
            op: 'resize_room',
            room_id: room.id,
            x: room.x,
            y: room.y,
            w: env[2] - room.x + 1.0,
            h: room.h,
          },
        ],
        422,
      );
    },
    kind: 'contract',
  },
  {
    id: 'contract-parity',
    group: 'Contracts',
    feature: 'Preview == applied (parity)',
    human: 'What the amber preview shows is what Apply lands',
    ai: 'The agent’s ops go through the identical pipeline',
    example: 'rename+move preview equals server geometry',
    check: async (ctx) => {
      const { geometry } = await ctx.head();
      const room = geometry.rooms.find((r) => r.z === 0 && r.w > 2)!;
      const ops: Op[] = [
        { op: 'rename', room_id: room.id, name: 'PARITY FINAL' },
        { op: 'resize_room', room_id: room.id, x: room.x, y: room.y, w: room.w - 0.05, h: room.h },
      ];
      await applyAndCompare(ctx, ops, 'check: parity', (p, a) => {
        const pr = p.rooms.find((r) => r.id === room.id)!;
        const ar = a.rooms.find((r) => r.id === room.id)!;
        expect(
          pr.name === ar.name && Math.abs(pr.w - ar.w) < 1e-6 && Math.abs(pr.x - ar.x) < 1e-6,
          'preview and applied geometry diverge',
        );
      });
    },
    kind: 'contract',
  },
];
