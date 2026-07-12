import { drag } from 'd3-drag';
import { pointer, select } from 'd3-selection';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Op } from '../editing';
import {
  EXTERIOR_HALF,
  INTERIOR_HALF,
  PX_PER_M,
  absToT,
  autoDims,
  diffRooms,
  px,
  snapM,
  tToAbs,
  viewport,
  wallCoord,
  wallHalf,
  wallIsVertical,
  wallLength,
  wallSpan,
} from '../geometry';
import type {
  Fixture,
  PlanGeometry,
  Room,
  Selection,
  Tool,
  Wall,
  WallSelection,
} from '../types';

const INK = '#141416';
const GREY = '#e1e1e3';
const RED = '#e23d28';
const GREEN = '#1a7f37';
const AMBER = '#9a6700';
const FAINT = '#74747a';

interface Props {
  geometry: PlanGeometry;
  original?: PlanGeometry | null;
  mode: 'proposed' | 'delta';
  selection: Selection;
  onSelectionChange: (s: Selection) => void;
  interactive: boolean;
  tool?: Tool;
  onTool?: (t: Tool) => void;
  onOps?: (ops: Op[]) => void;
  onRegion?: (r: { x: number; y: number; w: number; h: number }) => void;
  pendingIds?: Set<string>;
}

const SNAP = 0.05;
const snapT = (t: number) => Math.min(1, Math.max(0, Math.round(t / SNAP) * SNAP));

type DragState =
  | { kind: 'move'; obj: 'room' | 'fixture'; id: string; dx: number; dy: number }
  | { kind: 'resize'; obj: 'room' | 'fixture'; id: string; dw: number; dh: number }
  | null;

interface DrawState {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export default function PlanCanvas({
  geometry,
  original,
  mode,
  selection,
  onSelectionChange,
  interactive,
  tool = 'select',
  onTool,
  onOps,
  onRegion,
  pendingIds,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [multi, setMulti] = useState(false);
  const [dragState, setDragState] = useState<DragState>(null);
  const [draw, setDraw] = useState<DrawState | null>(null);
  const pressTimer = useRef<number | null>(null);
  const vp = viewport(geometry);
  const nestedIds = new Set(geometry.rooms.filter((r) => r.z !== 0).map((r) => r.id));
  const editable = interactive && Boolean(onOps);

  const X = (m: number) => vp.ox + px(m);
  const Y = (m: number) => vp.oy + px(m);

  /** Client coords → metres in plan space (viewBox-aware). */
  const toMetres = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { mx: 0, my: 0 };
      const ctm = svg.getScreenCTM();
      if (!ctm) return { mx: 0, my: 0 };
      const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { mx: (pt.x - vp.ox) / PX_PER_M, my: (pt.y - vp.oy) / PX_PER_M };
    },
    [vp.ox, vp.oy],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSelectionChange({ rooms: [], walls: [], fixtures: [], openings: [] });
        setMulti(false);
        setDraw(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelectionChange]);

  const toggleRoom = useCallback(
    (id: string, additive: boolean) => {
      if (!interactive) return;
      const has = selection.rooms.includes(id);
      if (additive || multi) {
        onSelectionChange({
          ...selection,
          rooms: has ? selection.rooms.filter((r) => r !== id) : [...selection.rooms, id],
        });
      } else {
        onSelectionChange({
          rooms: has && selection.rooms.length === 1 ? [] : [id],
          walls: [],
          fixtures: [],
          openings: [],
        });
      }
    },
    [interactive, multi, onSelectionChange, selection],
  );

  const toggleFixture = useCallback(
    (id: string, additive: boolean) => {
      if (!interactive) return;
      const has = selection.fixtures.includes(id);
      if (additive || multi) {
        onSelectionChange({
          ...selection,
          fixtures: has ? selection.fixtures.filter((f) => f !== id) : [...selection.fixtures, id],
        });
      } else {
        onSelectionChange({
          rooms: [],
          walls: [],
          fixtures: has && selection.fixtures.length === 1 ? [] : [id],
          openings: [],
        });
      }
    },
    [interactive, multi, onSelectionChange, selection],
  );

  // Select a wall chunk. When a wall carries openings, clicking picks the SOLID
  // segment (the "side") flanking the click point, so each side is editable on its
  // own; a wall with no openings selects whole.
  const selectWallChunk = useCallback(
    (wall: Wall, t0: number, t1: number, additive: boolean) => {
      if (!interactive) return;
      const whole = t0 <= 0.001 && t1 >= 0.999;
      const has = selection.walls.some((w) => w.id === wall.id);
      const entry: WallSelection = { id: wall.id, t0, t1, whole };
      if (additive || multi) {
        onSelectionChange({
          ...selection,
          walls: has
            ? selection.walls.filter((w) => w.id !== wall.id)
            : [...selection.walls, entry],
        });
      } else {
        onSelectionChange({
          rooms: [],
          walls: has && selection.walls.length === 1 && selection.walls[0].whole === whole ? [] : [entry],
          fixtures: [],
          openings: [],
        });
      }
    },
    [interactive, multi, onSelectionChange, selection],
  );

  const selectOpening = useCallback(
    (openingId: string, wallId: string) => {
      if (!interactive) return;
      const has = selection.openings.some((o) => o.id === openingId);
      onSelectionChange({
        rooms: [],
        walls: [],
        fixtures: [],
        openings: has ? [] : [{ id: openingId, wallId }],
      });
    },
    [interactive, onSelectionChange, selection.openings],
  );

  const placeOpening = useCallback(
    (wall: Wall, clientX: number, clientY: number) => {
      if (!onOps) return;
      const { mx, my } = toMetres(clientX, clientY);
      const along = wallIsVertical(wall) ? my : mx;
      const t = absToT(wall, along);
      const len = wallLength(wall);
      const half = Math.min(0.45 / Math.max(len, 0.1), 0.5);
      const t0 = Math.max(0, t - half);
      const t1 = Math.min(1, t + half);
      onOps([{ op: 'add_opening', wall_id: wall.id, t0: snapT(t0), t1: snapT(t1), type: 'door' }]);
      onTool?.('select');
    },
    [onOps, onTool, toMetres],
  );

  // long-press anywhere on the canvas → sticky multi-select mode
  const drawing = (tool === 'add-fixture' || tool === 'add-room') && editable;
  const onPointerDownBg = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    if (drawing) {
      const { mx, my } = toMetres(e.clientX, e.clientY);
      setDraw({ x0: mx, y0: my, x1: mx, y1: my });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    pressTimer.current = window.setTimeout(() => setMulti(true), 400);
  };
  const onPointerMoveBg = (e: React.PointerEvent<SVGSVGElement>) => {
    cancelPress();
    if (draw) {
      const { mx, my } = toMetres(e.clientX, e.clientY);
      setDraw({ ...draw, x1: mx, y1: my });
    }
  };
  const onPointerUpBg = (e: React.PointerEvent<SVGSVGElement>) => {
    cancelPress();
    if (draw) {
      const x = snapM(Math.min(draw.x0, draw.x1));
      const y = snapM(Math.min(draw.y0, draw.y1));
      const w = snapM(Math.abs(draw.x1 - draw.x0));
      const h = snapM(Math.abs(draw.y1 - draw.y0));
      const wasRoom = tool === 'add-room';
      setDraw(null);
      onTool?.('select');
      if (w >= 0.2 && h >= 0.2) {
        if (wasRoom) onRegion?.({ x, y, w, h });
        else onOps?.([{ op: 'add_fixture', x, y, w, h, label: '' }]);
      }
      e.stopPropagation();
    }
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const backgroundClick = () => {
    if (!interactive || draw) return;
    onSelectionChange({ rooms: [], walls: [], fixtures: [], openings: [] });
    setMulti(false);
  };

  const roomsById = new Map(geometry.rooms.map((r) => [r.id, r]));
  const fixturesById = new Map(geometry.fixtures.map((f) => [f.id, f]));
  const wallsById = new Map(geometry.walls.map((w) => [w.id, w]));
  const delta = mode === 'delta' && original ? diffRooms(original, geometry) : null;

  /** Rect adjusted for an in-flight drag (move/resize) of this object. */
  const liveRect = (obj: 'room' | 'fixture', id: string, r: { x: number; y: number; w: number; h: number }) => {
    if (dragState && dragState.obj === obj && dragState.id === id) {
      if (dragState.kind === 'move') {
        return { x: r.x + dragState.dx, y: r.y + dragState.dy, w: r.w, h: r.h };
      }
      return { x: r.x, y: r.y, w: Math.max(0.2, r.w + dragState.dw), h: Math.max(0.2, r.h + dragState.dh) };
    }
    return r;
  };

  const commitMoveResize = (obj: 'room' | 'fixture', id: string) => {
    if (!onOps || !dragState || dragState.id !== id) {
      setDragState(null);
      return;
    }
    const moved =
      dragState.kind === 'move'
        ? Math.abs(dragState.dx) + Math.abs(dragState.dy) > 1e-9
        : Math.abs(dragState.dw) + Math.abs(dragState.dh) > 1e-9;
    if (moved) {
      if (obj === 'room') {
        const r = roomsById.get(id);
        if (r) {
          const nr = liveRect('room', id, r);
          onOps([
            {
              op: 'resize_room',
              room_id: id,
              x: snapM(nr.x),
              y: snapM(nr.y),
              w: Math.max(0.7, snapM(nr.w)),
              h: Math.max(0.7, snapM(nr.h)),
            },
          ]);
        }
      } else {
        const f = fixturesById.get(id);
        if (f) {
          const nf = liveRect('fixture', id, f);
          onOps([
            {
              op: 'modify_fixture',
              fixture_id: id,
              x: snapM(nf.x),
              y: snapM(nf.y),
              w: Math.max(0.2, snapM(nf.w)),
              h: Math.max(0.2, snapM(nf.h)),
            },
          ]);
        }
      }
    }
    setDragState(null);
    return moved;
  };

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vp.width} ${vp.height}`}
        onPointerDown={onPointerDownBg}
        onPointerUp={onPointerUpBg}
        onPointerMove={onPointerMoveBg}
        onClick={backgroundClick}
        role="img"
        style={tool !== 'select' ? { cursor: 'crosshair' } : undefined}
        aria-label={`Floor plan of ${geometry.address || geometry.property}`}
      >
        {/* room fills */}
        {geometry.rooms
          .filter((r) => r.z === 0)
          .map((r) => {
            const lr = liveRect('room', r.id, r);
            const isNew = r.id.startsWith('pv-room');
            return (
              <rect
                key={`fill-${r.id}`}
                x={X(lr.x)}
                y={Y(lr.y)}
                width={px(lr.w)}
                height={px(lr.h)}
                fill={isNew ? 'rgba(26,127,55,0.14)' : r.fill === 'grey' ? GREY : '#fff'}
              />
            );
          })}
        {/* walls between z0 rooms */}
        {geometry.walls
          .filter((w) => !nestedIds.has(w.a) && !nestedIds.has(w.b))
          .map((w) => (
            <WallRect key={w.id} wall={w} X={X} Y={Y} />
          ))}
        {/* nested rooms + their walls on top */}
        {geometry.rooms
          .filter((r) => r.z !== 0)
          .map((r) => (
            <rect
              key={`fill-${r.id}`}
              x={X(r.x)}
              y={Y(r.y)}
              width={px(r.w)}
              height={px(r.h)}
              fill={r.fill === 'grey' ? GREY : '#fff'}
            />
          ))}
        {geometry.walls
          .filter((w) => nestedIds.has(w.a) || nestedIds.has(w.b))
          .map((w) => (
            <WallRect key={w.id} wall={w} X={X} Y={Y} />
          ))}
        {/* opening punches */}
        {geometry.walls.map((w) =>
          w.openings.map((o) => (
            <OpeningGap key={o.id} wall={w} t0={o.t0} t1={o.t1} type={o.type} X={X} Y={Y} />
          )),
        )}
        {/* fixtures + labels */}
        {geometry.fixtures.map((f) => {
          const lf = liveRect('fixture', f.id, f);
          return (
            <g key={`fx-${f.id}`}>
              <rect
                x={X(lf.x)}
                y={Y(lf.y)}
                width={px(lf.w)}
                height={px(lf.h)}
                fill="none"
                stroke={INK}
                strokeWidth={2}
              />
              <FixtureLabel fixture={{ ...f, ...lf }} X={X} Y={Y} />
            </g>
          );
        })}
        {/* labels */}
        {geometry.rooms.map((r) => (
          <RoomLabel key={`lb-${r.id}`} room={{ ...r, ...liveRect('room', r.id, r) }} X={X} Y={Y} />
        ))}

        {/* delta overlays */}
        {delta && (
          <g pointerEvents="none">
            {delta.removed.map((r) => (
              <g key={`rm-${r.id}`}>
                <rect
                  x={X(r.x)}
                  y={Y(r.y)}
                  width={px(r.w)}
                  height={px(r.h)}
                  fill="rgba(226,61,40,0.10)"
                  stroke={RED}
                  strokeWidth={2.5}
                  strokeDasharray="8 5"
                />
                {/* removed labels sit at the BOTTOM so they never collide with an added
                    room's label at the same top-left corner; white halo keeps them legible */}
                <text
                  x={X(r.x) + 6}
                  y={Y(r.y + r.h) - 5}
                  fontSize={11}
                  fill={RED}
                  fontWeight={700}
                  stroke="#fff"
                  strokeWidth={3.2}
                  paintOrder="stroke"
                >
                  − {r.name}
                </text>
              </g>
            ))}
            {[...delta.added].map((id) => {
              const r = roomsById.get(id);
              if (!r) return null;
              return (
                <g key={`ad-${id}`}>
                  <rect
                    x={X(r.x)}
                    y={Y(r.y)}
                    width={px(r.w)}
                    height={px(r.h)}
                    fill="rgba(26,127,55,0.13)"
                    stroke={GREEN}
                    strokeWidth={2.5}
                  />
                  <text
                    x={X(r.x) + 6}
                    y={Y(r.y) + 14}
                    fontSize={11}
                    fill={GREEN}
                    fontWeight={700}
                    stroke="#fff"
                    strokeWidth={3.2}
                    paintOrder="stroke"
                  >
                    + {r.name}
                  </text>
                </g>
              );
            })}
            {[...delta.modified.entries()].map(([id, was]) => {
              const r = roomsById.get(id);
              if (!r) return null;
              return (
                <g key={`md-${id}`}>
                  <rect
                    x={X(r.x)}
                    y={Y(r.y)}
                    width={px(r.w)}
                    height={px(r.h)}
                    fill="none"
                    stroke={AMBER}
                    strokeWidth={2.5}
                    strokeDasharray="3 3"
                  />
                  {was.name !== r.name && (
                    <text
                      x={X(r.x) + 6}
                      y={Y(r.y) + 14}
                      fontSize={10.5}
                      fill={AMBER}
                      fontWeight={700}
                      stroke="#fff"
                      strokeWidth={3.2}
                      paintOrder="stroke"
                    >
                      {was.name} → {r.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* pending (uncommitted) markers */}
        {pendingIds && (
          <g pointerEvents="none">
            {geometry.rooms
              .filter((r) => pendingIds.has(r.id) || r.id.startsWith('pv-room'))
              .map((r) => {
                const lr = liveRect('room', r.id, r);
                const isNew = r.id.startsWith('pv-room');
                // new rooms get a solid green boundary (walls derive on apply); edits stay amber
                return (
                  <rect
                    key={`pend-${r.id}`}
                    x={X(lr.x) - (isNew ? 1 : 3)}
                    y={Y(lr.y) - (isNew ? 1 : 3)}
                    width={px(lr.w) + (isNew ? 2 : 6)}
                    height={px(lr.h) + (isNew ? 2 : 6)}
                    fill="none"
                    stroke={isNew ? GREEN : AMBER}
                    strokeWidth={isNew ? 3 : 2.5}
                    strokeDasharray={isNew ? undefined : '4 3'}
                  />
                );
              })}
            {geometry.fixtures
              .filter((f) => pendingIds.has(f.id) || f.id.startsWith('pv-'))
              .map((f) => {
                const lf = liveRect('fixture', f.id, f);
                return (
                  <rect
                    key={`pend-${f.id}`}
                    x={X(lf.x) - 3}
                    y={Y(lf.y) - 3}
                    width={px(lf.w) + 6}
                    height={px(lf.h) + 6}
                    fill="none"
                    stroke={AMBER}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                  />
                );
              })}
          </g>
        )}

        {/* interaction layer */}
        {interactive && (
          <g>
            {geometry.rooms.map((r) => (
              <rect
                key={`hit-${r.id}`}
                className="room-hit"
                data-room={r.id}
                x={X(r.x)}
                y={Y(r.y)}
                width={px(r.w)}
                height={px(r.h)}
                fill="transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelPress();
                  if (tool === 'select') toggleRoom(r.id, e.shiftKey);
                }}
              >
                <title>{r.name}</title>
              </rect>
            ))}
            {geometry.walls.map((w) => {
              const [lo, hi] = wallSpan(w);
              const c = wallCoord(w);
              const vert = wallIsVertical(w);
              return (
                <line
                  key={`whit-${w.id}`}
                  className="wall-hit"
                  data-wall={w.id}
                  x1={vert ? X(c) : X(lo)}
                  y1={vert ? Y(lo) : Y(c)}
                  x2={vert ? X(c) : X(hi)}
                  y2={vert ? Y(hi) : Y(c)}
                  stroke="transparent"
                  strokeWidth={14}
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelPress();
                    if (tool === 'add-opening' && editable) {
                      placeOpening(w, e.clientX, e.clientY);
                      return;
                    }
                    const { mx, my } = toMetres(e.clientX, e.clientY);
                    const t = absToT(w, wallIsVertical(w) ? my : mx);
                    const [s0, s1] = solidSegmentAt(w, t);
                    selectWallChunk(w, s0, s1, e.shiftKey);
                  }}
                >
                  <title>{`${w.a} ↔ ${w.b}`}</title>
                </line>
              );
            })}
            {/* opening hit rects */}
            {geometry.walls.map((w) =>
              w.openings.map((o) => {
                const half = wallHalf(w) + 4;
                const a0 = tToAbs(w, o.t0);
                const a1 = tToAbs(w, o.t1);
                const c = wallCoord(w);
                const vert = wallIsVertical(w);
                const rect = vert
                  ? { x: X(c) - half, y: Y(a0), width: half * 2, height: px(a1 - a0) }
                  : { x: X(a0), y: Y(c) - half, width: px(a1 - a0), height: half * 2 };
                return (
                  <rect
                    key={`ohit-${o.id}`}
                    className="opening-hit"
                    data-opening={o.id}
                    {...rect}
                    fill="transparent"
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelPress();
                      if (tool === 'select') selectOpening(o.id, w.id);
                    }}
                  >
                    <title>{`${o.type} · ${w.a} ↔ ${w.b}`}</title>
                  </rect>
                );
              }),
            )}
            {/* fixture hit rects (above room hits) */}
            {geometry.fixtures.map((f) => (
              <rect
                key={`fhit-${f.id}`}
                className="fixture-hit"
                data-fixture={f.id}
                x={X(f.x) - 2}
                y={Y(f.y) - 2}
                width={px(f.w) + 4}
                height={px(f.h) + 4}
                fill="transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelPress();
                  if (tool === 'select') toggleFixture(f.id, e.shiftKey);
                }}
              >
                <title>{f.label || 'fixture'}</title>
              </rect>
            ))}
          </g>
        )}

        {/* selection overlays: rooms (draggable + resizable) */}
        {selection.rooms.map((id) => {
          const r = roomsById.get(id);
          if (!r) return null;
          const lr = liveRect('room', id, r);
          return (
            <SelectableRect
              key={`sel-${id}`}
              obj="room"
              id={id}
              rect={lr}
              X={X}
              Y={Y}
              editable={editable}
              toMetres={toMetres}
              dragState={dragState}
              setDragState={setDragState}
              onCommit={() => {
                const moved = commitMoveResize('room', id);
                if (!moved) toggleRoom(id, false);
              }}
            />
          );
        })}
        {/* selection overlays: fixtures */}
        {selection.fixtures.map((id) => {
          const f = fixturesById.get(id);
          if (!f) return null;
          const lf = liveRect('fixture', id, f);
          return (
            <SelectableRect
              key={`self-${id}`}
              obj="fixture"
              id={id}
              rect={lf}
              X={X}
              Y={Y}
              editable={editable}
              toMetres={toMetres}
              dragState={dragState}
              setDragState={setDragState}
              onCommit={() => {
                const moved = commitMoveResize('fixture', id);
                if (!moved) toggleFixture(id, false);
              }}
            />
          );
        })}
        {/* selection overlays: wall chunks */}
        {selection.walls.map((ws) => {
          const w = wallsById.get(ws.id);
          if (!w) return null;
          return (
            <ChunkOverlay
              key={`selw-${ws.id}`}
              wall={w}
              sel={ws}
              X={X}
              Y={Y}
              svgRef={svgRef}
              onChange={(t0, t1, whole) =>
                onSelectionChange({
                  ...selection,
                  walls: selection.walls.map((x) => (x.id === ws.id ? { ...x, t0, t1, whole } : x)),
                })
              }
            />
          );
        })}
        {/* selection overlays: openings */}
        {selection.openings.map((os) => {
          const w = wallsById.get(os.wallId);
          const o = w?.openings.find((x) => x.id === os.id);
          if (!w || !o) return null;
          return (
            <OpeningOverlay
              key={`selo-${os.id}`}
              wall={w}
              openingId={o.id}
              t0={o.t0}
              t1={o.t1}
              X={X}
              Y={Y}
              editable={editable}
              toMetres={toMetres}
              onCommit={(t0, t1) =>
                onOps?.([{ op: 'modify_opening', opening_id: o.id, t0, t1 }])
              }
            />
          );
        })}

        {/* selected space (region) → becomes a new room or an agent target */}
        {selection.region && (
          <g pointerEvents="none">
            <rect
              x={X(selection.region.x)}
              y={Y(selection.region.y)}
              width={px(selection.region.w)}
              height={px(selection.region.h)}
              fill="rgba(226,61,40,0.08)"
              stroke={RED}
              strokeWidth={2.5}
              strokeDasharray="7 4"
            />
            <text
              x={X(selection.region.x + selection.region.w / 2)}
              y={Y(selection.region.y + selection.region.h / 2)}
              fontSize={11}
              fontWeight={700}
              textAnchor="middle"
              fill={RED}
              stroke="#fff"
              strokeWidth={3}
              paintOrder="stroke"
            >
              NEW ROOM · {selection.region.w.toFixed(1)}×{selection.region.h.toFixed(1)}m
            </text>
          </g>
        )}

        {/* add-fixture / add-room draw preview */}
        {draw && (
          <rect
            x={X(Math.min(draw.x0, draw.x1))}
            y={Y(Math.min(draw.y0, draw.y1))}
            width={px(Math.abs(draw.x1 - draw.x0))}
            height={px(Math.abs(draw.y1 - draw.y0))}
            fill="rgba(154,103,0,0.08)"
            stroke={AMBER}
            strokeWidth={2}
            strokeDasharray="5 4"
            pointerEvents="none"
          />
        )}

        {multi && (
          <text x={10} y={20} fontSize={12} fontWeight={700} fill={RED} letterSpacing={2}>
            MULTI-SELECT — click objects, Esc to clear
          </text>
        )}
        {tool === 'add-opening' && (
          <text x={10} y={20} fontSize={12} fontWeight={700} fill={AMBER} letterSpacing={2}>
            ADD OPENING — click a wall
          </text>
        )}
        {tool === 'add-fixture' && (
          <text x={10} y={20} fontSize={12} fontWeight={700} fill={AMBER} letterSpacing={2}>
            ADD FIXTURE — drag a rectangle
          </text>
        )}
        {tool === 'add-room' && (
          <text x={10} y={20} fontSize={12} fontWeight={700} fill={AMBER} letterSpacing={2}>
            ADD ROOM — drag out the space
          </text>
        )}
      </svg>
    </div>
  );
}

/** Red dashed selection rect with move-drag + corner resize handle. */
function SelectableRect({
  obj,
  id,
  rect,
  X,
  Y,
  editable,
  toMetres,
  dragState,
  setDragState,
  onCommit,
}: {
  obj: 'room' | 'fixture';
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  X: (m: number) => number;
  Y: (m: number) => number;
  editable: boolean;
  toMetres: (cx: number, cy: number) => { mx: number; my: number };
  dragState: DragState;
  setDragState: (s: DragState) => void;
  onCommit: () => void;
}) {
  const start = useRef<{ mx: number; my: number } | null>(null);

  const beginDrag = (e: React.PointerEvent, kind: 'move' | 'resize') => {
    if (!editable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    start.current = toMetres(e.clientX, e.clientY);
    setDragState(
      kind === 'move'
        ? { kind: 'move', obj, id, dx: 0, dy: 0 }
        : { kind: 'resize', obj, id, dw: 0, dh: 0 },
    );
  };
  const moveDrag = (e: React.PointerEvent, kind: 'move' | 'resize') => {
    if (!start.current || !dragState || dragState.id !== id || dragState.kind !== kind) return;
    e.stopPropagation();
    const { mx, my } = toMetres(e.clientX, e.clientY);
    const dx = snapM(mx - start.current.mx);
    const dy = snapM(my - start.current.my);
    setDragState(kind === 'move' ? { kind, obj, id, dx, dy } : { kind, obj, id, dw: dx, dh: dy });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!start.current) return;
    e.stopPropagation();
    start.current = null;
    onCommit();
  };

  const resizing = dragState?.id === id && dragState.kind === 'resize';
  return (
    <g>
      <rect
        x={X(rect.x)}
        y={Y(rect.y)}
        width={px(rect.w)}
        height={px(rect.h)}
        fill="rgba(226,61,40,0.08)"
        stroke={RED}
        strokeWidth={obj === 'room' ? 3 : 2.5}
        strokeDasharray="7 4"
        style={{ cursor: editable ? 'move' : 'default' }}
        onPointerDown={(e) => beginDrag(e, 'move')}
        onPointerMove={(e) => moveDrag(e, 'move')}
        onPointerUp={endDrag}
        onClick={(e) => e.stopPropagation()}
      />
      {editable && (
        <circle
          cx={X(rect.x + rect.w)}
          cy={Y(rect.y + rect.h)}
          r={7}
          fill="#fff"
          stroke={RED}
          strokeWidth={3}
          style={{ cursor: 'nwse-resize' }}
          onPointerDown={(e) => beginDrag(e, 'resize')}
          onPointerMove={(e) => moveDrag(e, 'resize')}
          onPointerUp={endDrag}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {resizing && (
        <text
          x={X(rect.x + rect.w / 2)}
          y={Y(rect.y) - 8}
          fontSize={11}
          fontWeight={700}
          textAnchor="middle"
          fill={RED}
          pointerEvents="none"
        >
          {rect.w.toFixed(2)} x {rect.h.toFixed(2)}m
        </text>
      )}
    </g>
  );
}

/** The solid wall segment (t0,t1) containing t, bounded by adjacent openings.
 * A wall with no openings yields the whole span [0,1]. */
function solidSegmentAt(wall: Wall, t: number): [number, number] {
  const edges = wall.openings
    .map((o): [number, number] => [Math.min(o.t0, o.t1), Math.max(o.t0, o.t1)])
    .sort((a, b) => a[0] - b[0]);
  let lo = 0;
  for (const [a, b] of edges) {
    if (t < a) return [lo, a];
    lo = b;
  }
  return [lo, 1];
}

function WallRect({ wall, X, Y }: { wall: Wall; X: (m: number) => number; Y: (m: number) => number }) {
  const half = wallHalf(wall);
  const [lo, hi] = wallSpan(wall);
  const c = wallCoord(wall);
  return wallIsVertical(wall) ? (
    <rect x={X(c) - half} y={Y(lo) - half} width={half * 2} height={px(hi - lo) + half * 2} fill={INK} />
  ) : (
    <rect x={X(lo) - half} y={Y(c) - half} width={px(hi - lo) + half * 2} height={half * 2} fill={INK} />
  );
}

function OpeningGap({
  wall,
  t0,
  t1,
  type,
  X,
  Y,
}: {
  wall: Wall;
  t0: number;
  t1: number;
  type: string;
  X: (m: number) => number;
  Y: (m: number) => number;
}) {
  const half = (wall.b === 'exterior' ? EXTERIOR_HALF : INTERIOR_HALF) * PX_PER_M + 2;
  const a0 = tToAbs(wall, t0);
  const a1 = tToAbs(wall, t1);
  const c = wallCoord(wall);
  const vert = wallIsVertical(wall);
  const rect = vert
    ? { x: X(c) - half, y: Y(a0), width: half * 2, height: px(a1 - a0) }
    : { x: X(a0), y: Y(c) - half, width: px(a1 - a0), height: half * 2 };
  return (
    <g>
      <rect {...rect} fill="#fff" />
      {type === 'window' &&
        (vert ? (
          <>
            <line x1={rect.x + 1} y1={rect.y} x2={rect.x + 1} y2={rect.y + rect.height} stroke={INK} strokeWidth={2} />
            <line x1={rect.x + rect.width - 1} y1={rect.y} x2={rect.x + rect.width - 1} y2={rect.y + rect.height} stroke={INK} strokeWidth={2} />
          </>
        ) : (
          <>
            <line x1={rect.x} y1={rect.y + 1} x2={rect.x + rect.width} y2={rect.y + 1} stroke={INK} strokeWidth={2} />
            <line x1={rect.x} y1={rect.y + rect.height - 1} x2={rect.x + rect.width} y2={rect.y + rect.height - 1} stroke={INK} strokeWidth={2} />
          </>
        ))}
    </g>
  );
}

function RoomLabel({ room, X, Y }: { room: Room; X: (m: number) => number; Y: (m: number) => number }) {
  const wPx = px(room.w);
  const hPx = px(room.h);
  const name = room.name.toUpperCase();
  const size = Math.max(6.5, Math.min(13, Math.min(wPx / (name.length * 0.68), hPx / 3)));
  const dims = autoDims(room);
  // dims are ALWAYS shown (style-guide invariant) — shrink instead of hiding
  const dimSize = Math.max(6, Math.min(size * 0.82, wPx / (dims.length * 0.6)));
  const cx = X(room.x) + wPx / 2;
  const cy = Y(room.y) + hPx / 2;
  return (
    <g pointerEvents="none">
      <text className="label-name" x={cx} y={cy - 2} fontSize={size} textAnchor="middle" fill={INK}>
        {name}
      </text>
      <text x={cx} y={cy + dimSize + 1} fontSize={dimSize} textAnchor="middle" fill={FAINT}>
        {dims}
      </text>
    </g>
  );
}

function FixtureLabel({
  fixture,
  X,
  Y,
}: {
  fixture: Fixture;
  X: (m: number) => number;
  Y: (m: number) => number;
}) {
  const label = (fixture.label || '').toUpperCase();
  if (!label) return null;
  const wPx = px(fixture.w);
  const hPx = px(fixture.h);
  const size = Math.min(9, wPx / (label.length * 0.68), hPx * 0.7);
  if (size < 5.5) return null;
  return (
    <text
      x={X(fixture.x) + wPx / 2}
      y={Y(fixture.y) + hPx / 2 + size / 3}
      fontSize={size}
      textAnchor="middle"
      fill={FAINT}
      pointerEvents="none"
    >
      {label}
    </text>
  );
}

/** Selected opening: red bar + draggable end handles (modify_opening on release). */
function OpeningOverlay({
  wall,
  openingId,
  t0,
  t1,
  X,
  Y,
  editable,
  toMetres,
  onCommit,
}: {
  wall: Wall;
  openingId: string;
  t0: number;
  t1: number;
  X: (m: number) => number;
  Y: (m: number) => number;
  editable: boolean;
  toMetres: (cx: number, cy: number) => { mx: number; my: number };
  onCommit: (t0: number, t1: number) => void;
}) {
  const [local, setLocal] = useState<{ t0: number; t1: number } | null>(null);
  const dragging = useRef<0 | 1 | null>(null);
  useEffect(() => setLocal(null), [openingId, t0, t1]);

  const cur = local ?? { t0, t1 };
  const vert = wallIsVertical(wall);
  const c = wallCoord(wall);
  const a0 = tToAbs(wall, cur.t0);
  const a1 = tToAbs(wall, cur.t1);
  const line = vert
    ? { x1: X(c), y1: Y(a0), x2: X(c), y2: Y(a1) }
    : { x1: X(a0), y1: Y(c), x2: X(a1), y2: Y(c) };

  const onDown = (which: 0 | 1) => (e: React.PointerEvent) => {
    if (!editable) return;
    e.stopPropagation();
    dragging.current = which;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragging.current === null) return;
    e.stopPropagation();
    const { mx, my } = toMetres(e.clientX, e.clientY);
    const t = snapT(absToT(wall, vert ? my : mx));
    if (dragging.current === 0) setLocal({ t0: Math.min(t, cur.t1 - SNAP), t1: cur.t1 });
    else setLocal({ t0: cur.t0, t1: Math.max(t, cur.t0 + SNAP) });
  };
  const onUp = (e: React.PointerEvent) => {
    if (dragging.current === null) return;
    e.stopPropagation();
    dragging.current = null;
    if (local && (Math.abs(local.t0 - t0) > 1e-9 || Math.abs(local.t1 - t1) > 1e-9)) {
      onCommit(local.t0, local.t1);
    }
  };

  const cursor = vert ? 'ns-resize' : 'ew-resize';
  return (
    <g>
      <line {...line} stroke={RED} strokeWidth={9} strokeLinecap="round" opacity={0.7} pointerEvents="none" />
      <circle cx={line.x1} cy={line.y1} r={6.5} fill="#fff" stroke={RED} strokeWidth={3} style={{ cursor }} onPointerDown={onDown(0)} onPointerMove={onMove} onPointerUp={onUp} />
      <circle cx={line.x2} cy={line.y2} r={6.5} fill="#fff" stroke={RED} strokeWidth={3} style={{ cursor }} onPointerDown={onDown(1)} onPointerMove={onMove} onPointerUp={onUp} />
      <text
        x={(line.x1 + line.x2) / 2 + (vert ? 14 : 0)}
        y={(line.y1 + line.y2) / 2 - (vert ? 0 : 12)}
        fontSize={11}
        fontWeight={700}
        textAnchor="middle"
        fill={RED}
        pointerEvents="none"
      >
        {((cur.t1 - cur.t0) * wallLength(wall)).toFixed(1)}m
      </text>
    </g>
  );
}

function ChunkOverlay({
  wall,
  sel,
  X,
  Y,
  svgRef,
  onChange,
}: {
  wall: Wall;
  sel: WallSelection;
  X: (m: number) => number;
  Y: (m: number) => number;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onChange: (t0: number, t1: number, whole: boolean) => void;
}) {
  const vert = wallIsVertical(wall);
  const c = wallCoord(wall);
  const a0 = tToAbs(wall, sel.t0);
  const a1 = tToAbs(wall, sel.t1);
  const h0 = useRef<SVGCircleElement>(null);
  const h1 = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const attach = (el: SVGCircleElement | null, which: 0 | 1) => {
      if (!el) return;
      const behavior = drag<SVGCircleElement, unknown>().on('drag', (event) => {
        const [mx, my] = pointer(event.sourceEvent as PointerEvent, svg);
        // convert px back to metres along the wall axis
        const metre = vert ? (my - Y(0)) / PX_PER_M : (mx - X(0)) / PX_PER_M;
        const t = snapT(absToT(wall, metre));
        if (which === 0) onChange(Math.min(t, sel.t1 - SNAP), sel.t1, false);
        else onChange(sel.t0, Math.max(t, sel.t0 + SNAP), false);
      });
      select(el).call(behavior);
    };
    attach(h0.current, 0);
    attach(h1.current, 1);
  });

  const line = vert
    ? { x1: X(c), y1: Y(a0), x2: X(c), y2: Y(a1) }
    : { x1: X(a0), y1: Y(c), x2: X(a1), y2: Y(c) };
  return (
    <g>
      <line {...line} stroke={RED} strokeWidth={9} strokeLinecap="round" opacity={0.85} pointerEvents="none" />
      <circle ref={h0} cx={line.x1} cy={line.y1} r={7} fill="#fff" stroke={RED} strokeWidth={3} style={{ cursor: vert ? 'ns-resize' : 'ew-resize' }} />
      <circle ref={h1} cx={line.x2} cy={line.y2} r={7} fill="#fff" stroke={RED} strokeWidth={3} style={{ cursor: vert ? 'ns-resize' : 'ew-resize' }} />
      {!sel.whole && (
        <text
          x={(line.x1 + line.x2) / 2}
          y={(line.y1 + line.y2) / 2 - 12}
          fontSize={11}
          fontWeight={700}
          textAnchor="middle"
          fill={RED}
          pointerEvents="none"
        >
          {((sel.t1 - sel.t0) * (tToAbs(wall, 1) - tToAbs(wall, 0))).toFixed(1)}m chunk
        </text>
      )}
    </g>
  );
}
