import { useEffect, useState } from 'react';
import type { Op } from '../editing';
import { describeOp } from '../editing';
import { wallLength } from '../geometry';
import type { OpeningType, PlanGeometry, Selection, Tool } from '../types';

const KINDS = [
  'bedroom',
  'living',
  'kitchen',
  'wet',
  'laundry',
  'storage',
  'circulation',
  'utility',
  'room',
] as const;

interface Props {
  geometry: PlanGeometry;
  selection: Selection;
  pending: Op[];
  busy: boolean;
  atHead: boolean;
  tool: Tool;
  onTool: (t: Tool) => void;
  onOps: (ops: Op[]) => void;
  onRemovePending: (index: number) => void;
  onApply: () => void;
  onDiscard: () => void;
}

export default function Inspector({
  geometry,
  selection,
  pending,
  busy,
  atHead,
  tool,
  onTool,
  onOps,
  onRemovePending,
  onApply,
  onDiscard,
}: Props) {
  const room = selection.rooms.length === 1 ? geometry.rooms.find((r) => r.id === selection.rooms[0]) : undefined;
  const fixture =
    selection.fixtures.length === 1 ? geometry.fixtures.find((f) => f.id === selection.fixtures[0]) : undefined;
  const wallSel = selection.walls.length === 1 ? selection.walls[0] : undefined;
  const wall = wallSel ? geometry.walls.find((w) => w.id === wallSel.id) : undefined;
  const openingSel = selection.openings.length === 1 ? selection.openings[0] : undefined;
  const openingWall = openingSel ? geometry.walls.find((w) => w.id === openingSel.wallId) : undefined;
  const opening = openingWall?.openings.find((o) => o.id === openingSel?.id);

  return (
    <>
      <div className="body" style={{ paddingBottom: 0 }}>
        <div className="cvtools">
          <button className={tool === 'select' ? 'on' : ''} onClick={() => onTool('select')}>
            Select
          </button>
          <button
            className={tool === 'add-opening' ? 'on' : ''}
            disabled={!atHead}
            onClick={() => onTool(tool === 'add-opening' ? 'select' : 'add-opening')}
          >
            + Opening
          </button>
          <button
            className={tool === 'add-room' ? 'on' : ''}
            disabled={!atHead}
            onClick={() => onTool(tool === 'add-room' ? 'select' : 'add-room')}
          >
            + Room
          </button>
          <button
            className={tool === 'add-fixture' ? 'on' : ''}
            disabled={!atHead}
            onClick={() => onTool(tool === 'add-fixture' ? 'select' : 'add-fixture')}
          >
            + Fixture
          </button>
          <span className="toolhint">Esc clears · shift-click multi-select</span>
        </div>
      </div>

      {selection.region && atHead && (
        <RegionEditor key="region" region={selection.region} onOps={onOps} />
      )}
      {room && atHead && <RoomEditor key={room.id} room={room} onOps={onOps} />}
      {fixture && atHead && <FixtureEditor key={fixture.id} fixture={fixture} onOps={onOps} />}
      {wall && wallSel && atHead && (
        <div className="body inspector-pane">
          <div className="what">
            {wall.a} ↔ {wall.b} <span className="chip dim">{wallLength(wall).toFixed(1)}m wall</span>
            {!wallSel.whole && (
              <span className="chip">{((wallSel.t1 - wallSel.t0) * wallLength(wall)).toFixed(1)}m chunk</span>
            )}
          </div>
          <div className="btnrow">
            <button
              className="primary"
              onClick={() =>
                onOps([{ op: 'remove_wall_chunk', wall_id: wall.id, t0: wallSel.t0, t1: wallSel.t1 }])
              }
            >
              Open this {wallSel.whole ? 'wall' : 'chunk'}
            </button>
            <button
              className="ghost"
              onClick={() =>
                onOps([{ op: 'add_opening', wall_id: wall.id, t0: wallSel.whole ? 0.4 : wallSel.t0, t1: wallSel.whole ? 0.6 : wallSel.t1, type: 'door' }])
              }
            >
              + door
            </button>
            <button
              className="ghost"
              onClick={() =>
                onOps([{ op: 'add_opening', wall_id: wall.id, t0: wallSel.whole ? 0.35 : wallSel.t0, t1: wallSel.whole ? 0.65 : wallSel.t1, type: 'window' }])
              }
            >
              + window
            </button>
          </div>
          <div className="note">Walls re-derive from rooms on apply — move rooms, not walls.</div>
        </div>
      )}
      {opening && openingWall && atHead && (
        <div className="body inspector-pane">
          <div className="what">
            {opening.type} <span className="chip dim">{openingWall.a} ↔ {openingWall.b}</span>
            <span className="chip dim">
              {((opening.t1 - opening.t0) * wallLength(openingWall)).toFixed(1)}m
            </span>
          </div>
          <div className="btnrow">
            {(['door', 'window', 'open'] as OpeningType[]).map((t) => (
              <button
                key={t}
                className={opening.type === t ? 'primary' : 'ghost'}
                onClick={() =>
                  opening.type !== t && onOps([{ op: 'modify_opening', opening_id: opening.id, type: t }])
                }
              >
                {t}
              </button>
            ))}
            <button
              className="ghost"
              title="Duplicate this opening along the same wall"
              onClick={() => {
                const len = opening.t1 - opening.t0;
                const gap = 0.06;
                let n0 = opening.t1 + gap;
                let n1 = n0 + len;
                if (n1 > 1) {
                  n1 = opening.t0 - gap;
                  n0 = n1 - len;
                }
                if (n0 >= 0 && n1 <= 1) {
                  onOps([{ op: 'add_opening', wall_id: openingWall.id, t0: n0, t1: n1, type: opening.type }]);
                }
              }}
            >
              Duplicate
            </button>
            <button
              className="ghost danger"
              onClick={() => onOps([{ op: 'remove_opening', opening_id: opening.id }])}
            >
              remove
            </button>
          </div>
          <div className="note">Drag the handles on the plan to move its ends · Ctrl+C / Ctrl+V to copy.</div>
        </div>
      )}

      <div className="body">
        {pending.length === 0 ? (
          <div className="note" style={{ marginTop: 0 }}>
            {atHead
              ? 'No pending edits. Click an object, edit it here or drag it on the plan — edits batch until you apply.'
              : 'Viewing an old version — jump to the head version to edit.'}
          </div>
        ) : (
          <>
            <ul className="pendinglist">
              {pending.map((op, i) => (
                <li key={i}>
                  <span>{describeOp(op)}</span>
                  <button className="ghost" onClick={() => onRemovePending(i)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="btnrow">
              <button className="primary" disabled={busy || !atHead} onClick={onApply}>
                {busy ? 'Applying…' : `Apply ${pending.length} edit${pending.length === 1 ? '' : 's'}`}
              </button>
              <button className="ghost" disabled={busy} onClick={onDiscard}>
                Discard
              </button>
            </div>
            <div className="note">
              Applies instantly — no agent. Rent is carried unchanged and flagged for re-assessment.
            </div>
          </>
        )}
      </div>
    </>
  );
}

function RegionEditor({
  region,
  onOps,
}: {
  region: { x: number; y: number; w: number; h: number };
  onOps: (ops: Op[]) => void;
}) {
  const [name, setName] = useState('BUTLERS PANTRY');
  const [kind, setKind] = useState('storage');
  return (
    <div className="body inspector-pane">
      <div className="what">
        New room here <span className="chip">space</span>{' '}
        <span className="chip dim">
          {region.w.toFixed(1)} × {region.h.toFixed(1)}m
        </span>
      </div>
      <div className="frow one">
        <label className="f">
          <span>Room name</span>
          <input value={name} placeholder="e.g. butlers pantry" onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="frow">
        <label className="f">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="btnrow">
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() =>
            onOps([
              {
                op: 'add_room',
                name: name.trim(),
                kind,
                x: region.x,
                y: region.y,
                w: region.w,
                h: region.h,
                fill: kind === 'storage' || kind === 'utility' ? 'grey' : 'white',
              },
            ])
          }
        >
          Add room
        </button>
      </div>
      <div className="note">Or describe what to build here to the agent below — the space is the target.</div>
    </div>
  );
}

function RoomEditor({ room, onOps }: { room: { id: string; name: string; kind: string; x: number; y: number; w: number; h: number; fill: 'white' | 'grey' }; onOps: (ops: Op[]) => void }) {
  const [name, setName] = useState(room.name);
  const [kind, setKind] = useState(room.kind);
  const [fill, setFill] = useState<'white' | 'grey'>(room.fill);
  const [rect, setRect] = useState({ x: room.x, y: room.y, w: room.w, h: room.h });
  useEffect(() => {
    setName(room.name);
    setKind(room.kind);
    setFill(room.fill);
    setRect({ x: room.x, y: room.y, w: room.w, h: room.h });
  }, [room.name, room.kind, room.fill, room.x, room.y, room.w, room.h]);

  const dirtyMeta = name !== room.name || kind !== room.kind || fill !== room.fill;
  const dirtyRect =
    Math.abs(rect.x - room.x) + Math.abs(rect.y - room.y) + Math.abs(rect.w - room.w) + Math.abs(rect.h - room.h) >
    1e-9;

  const queue = () => {
    const ops: Op[] = [];
    if (dirtyMeta) {
      ops.push({
        op: 'set_kind',
        room_id: room.id,
        ...(name !== room.name ? { name } : {}),
        ...(kind !== room.kind ? { kind } : {}),
        ...(fill !== room.fill ? { fill } : {}),
      });
    }
    if (dirtyRect) {
      ops.push({ op: 'resize_room', room_id: room.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }
    if (ops.length) onOps(ops);
  };

  return (
    <div className="body inspector-pane">
      <div className="what">
        {room.name} <span className="chip">room</span> <span className="chip dim">{room.id}</span>
      </div>
      <div className="frow one">
        <label className="f">
          <span>Name — edit and press Enter</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                queue();
              }
            }}
          />
        </label>
      </div>
      <div className="frow">
        <label className="f">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          <span>Fill</span>
          <select value={fill} onChange={(e) => setFill(e.target.value as 'white' | 'grey')}>
            <option value="white">white (habitable)</option>
            <option value="grey">grey (non-habitable)</option>
          </select>
        </label>
      </div>
      <RectFields rect={rect} onChange={setRect} minSide={0.7} />
      <div className="btnrow">
        <button className="primary" disabled={!dirtyMeta && !dirtyRect} onClick={queue}>
          Queue edit
        </button>
        <button
          className="ghost"
          title="Duplicate this room beside the original (needs free space to apply)"
          onClick={() =>
            onOps([
              {
                op: 'add_room',
                name: `${room.name} copy`,
                kind: room.kind,
                x: room.x + room.w + 0.15,
                y: room.y,
                w: room.w,
                h: room.h,
                fill: room.fill,
              },
            ])
          }
        >
          Duplicate
        </button>
        <button className="ghost danger" onClick={() => onOps([{ op: 'remove_room', room_id: room.id }])}>
          Remove room
        </button>
      </div>
    </div>
  );
}

function FixtureEditor({
  fixture,
  onOps,
}: {
  fixture: { id: string; label: string; x: number; y: number; w: number; h: number };
  onOps: (ops: Op[]) => void;
}) {
  const [label, setLabel] = useState(fixture.label);
  const [rect, setRect] = useState({ x: fixture.x, y: fixture.y, w: fixture.w, h: fixture.h });
  useEffect(() => {
    setLabel(fixture.label);
    setRect({ x: fixture.x, y: fixture.y, w: fixture.w, h: fixture.h });
  }, [fixture.label, fixture.x, fixture.y, fixture.w, fixture.h]);

  const dirty =
    label !== fixture.label ||
    Math.abs(rect.x - fixture.x) + Math.abs(rect.y - fixture.y) + Math.abs(rect.w - fixture.w) + Math.abs(rect.h - fixture.h) >
      1e-9;

  const queue = () => {
    if (!dirty) return;
    onOps([
      {
        op: 'modify_fixture',
        fixture_id: fixture.id,
        ...(label !== fixture.label ? { label } : {}),
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
      },
    ]);
  };

  return (
    <div className="body inspector-pane">
      <div className="what">
        {fixture.label || 'Fixture'} <span className="chip">fixture</span>{' '}
        <span className="chip dim">{fixture.id}</span>
      </div>
      <div className="frow one">
        <label className="f">
          <span>Label — edit and press Enter</span>
          <input
            value={label}
            placeholder="e.g. island bench"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                queue();
              }
            }}
          />
        </label>
      </div>
      <RectFields rect={rect} onChange={setRect} minSide={0.2} />
      <div className="btnrow">
        <button className="primary" disabled={!dirty} onClick={queue}>
          Queue edit
        </button>
        <button
          className="ghost"
          title="Duplicate this fixture, offset slightly"
          onClick={() =>
            onOps([
              {
                op: 'add_fixture',
                x: fixture.x + 0.3,
                y: fixture.y + 0.3,
                w: fixture.w,
                h: fixture.h,
                label: fixture.label ? `${fixture.label} copy` : '',
              },
            ])
          }
        >
          Duplicate
        </button>
        <button
          className="ghost danger"
          onClick={() => onOps([{ op: 'remove_fixture', fixture_id: fixture.id }])}
        >
          Remove fixture
        </button>
      </div>
    </div>
  );
}

function RectFields({
  rect,
  onChange,
  minSide,
}: {
  rect: { x: number; y: number; w: number; h: number };
  onChange: (r: { x: number; y: number; w: number; h: number }) => void;
  minSide: number;
}) {
  const num = (key: 'x' | 'y' | 'w' | 'h') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (Number.isNaN(v)) return;
    onChange({ ...rect, [key]: key === 'w' || key === 'h' ? Math.max(minSide, v) : v });
  };
  return (
    <>
      <div className="frow">
        <label className="f">
          <span>x (m)</span>
          <input type="number" step={0.05} value={rect.x.toFixed(2)} onChange={num('x')} />
        </label>
        <label className="f">
          <span>y (m)</span>
          <input type="number" step={0.05} value={rect.y.toFixed(2)} onChange={num('y')} />
        </label>
      </div>
      <div className="frow">
        <label className="f">
          <span>w (m)</span>
          <input type="number" step={0.05} value={rect.w.toFixed(2)} onChange={num('w')} />
        </label>
        <label className="f">
          <span>h (m)</span>
          <input type="number" step={0.05} value={rect.h.toFixed(2)} onChange={num('h')} />
        </label>
      </div>
    </>
  );
}
