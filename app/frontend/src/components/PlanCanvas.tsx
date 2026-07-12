import { drag } from 'd3-drag';
import { select, pointer } from 'd3-selection';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EXTERIOR_HALF,
  INTERIOR_HALF,
  PX_PER_M,
  absToT,
  autoDims,
  diffRooms,
  px,
  tToAbs,
  viewport,
  wallCoord,
  wallHalf,
  wallIsVertical,
  wallSpan,
} from '../geometry';
import type { PlanGeometry, Room, Selection, Wall, WallSelection } from '../types';

const INK = '#141416';
const GREY = '#e1e1e3';
const RED = '#e23d28';
const GREEN = '#1a7f37';
const AMBER = '#9a6700';

interface Props {
  geometry: PlanGeometry;
  original?: PlanGeometry | null;
  mode: 'proposed' | 'delta';
  selection: Selection;
  onSelectionChange: (s: Selection) => void;
  interactive: boolean;
}

const SNAP = 0.05;
const snap = (t: number) => Math.min(1, Math.max(0, Math.round(t / SNAP) * SNAP));

export default function PlanCanvas({
  geometry,
  original,
  mode,
  selection,
  onSelectionChange,
  interactive,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [multi, setMulti] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const vp = viewport(geometry);
  const nestedIds = new Set(geometry.rooms.filter((r) => r.z !== 0).map((r) => r.id));

  const X = (m: number) => vp.ox + px(m);
  const Y = (m: number) => vp.oy + px(m);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSelectionChange({ rooms: [], walls: [] });
        setMulti(false);
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
        onSelectionChange({ rooms: has && selection.rooms.length === 1 ? [] : [id], walls: [] });
      }
    },
    [interactive, multi, onSelectionChange, selection],
  );

  const toggleWall = useCallback(
    (wall: Wall, additive: boolean) => {
      if (!interactive) return;
      const has = selection.walls.some((w) => w.id === wall.id);
      const entry: WallSelection = { id: wall.id, t0: 0, t1: 1, whole: true };
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
          walls: has && selection.walls.length === 1 ? [] : [entry],
        });
      }
    },
    [interactive, multi, onSelectionChange, selection],
  );

  // long-press anywhere on the canvas → sticky multi-select mode
  const onPointerDown = () => {
    if (!interactive) return;
    pressTimer.current = window.setTimeout(() => setMulti(true), 400);
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const backgroundClick = () => {
    if (!interactive) return;
    onSelectionChange({ rooms: [], walls: [] });
    setMulti(false);
  };

  const roomsById = new Map(geometry.rooms.map((r) => [r.id, r]));
  const wallsById = new Map(geometry.walls.map((w) => [w.id, w]));
  const delta = mode === 'delta' && original ? diffRooms(original, geometry) : null;

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vp.width} ${vp.height}`}
        onPointerDown={onPointerDown}
        onPointerUp={cancelPress}
        onPointerMove={cancelPress}
        onClick={backgroundClick}
        role="img"
        aria-label={`Floor plan of ${geometry.address || geometry.property}`}
      >
        {/* room fills */}
        {geometry.rooms
          .filter((r) => r.z === 0)
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
        {geometry.walls.map((w) => w.openings.map((o) => <OpeningGap key={o.id} wall={w} t0={o.t0} t1={o.t1} type={o.type} X={X} Y={Y} />))}
        {/* fixtures */}
        {geometry.fixtures.map((f, i) => (
          <rect
            key={`fx-${i}`}
            x={X(f.x)}
            y={Y(f.y)}
            width={px(f.w)}
            height={px(f.h)}
            fill="none"
            stroke={INK}
            strokeWidth={2}
          />
        ))}
        {/* labels */}
        {geometry.rooms.map((r) => (
          <RoomLabel key={`lb-${r.id}`} room={r} X={X} Y={Y} />
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
                <text x={X(r.x) + 6} y={Y(r.y) + 15} fontSize={11} fill={RED} fontWeight={700}>
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
                  <text x={X(r.x) + 6} y={Y(r.y) + 15} fontSize={11} fill={GREEN} fontWeight={700}>
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
                    <text x={X(r.x) + 6} y={Y(r.y + r.h) - 7} fontSize={10.5} fill={AMBER} fontWeight={700}>
                      {was.name} → {r.name}
                    </text>
                  )}
                </g>
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
                  toggleRoom(r.id, e.shiftKey);
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
                    toggleWall(w, e.shiftKey);
                  }}
                >
                  <title>{`${w.a} ↔ ${w.b}`}</title>
                </line>
              );
            })}
          </g>
        )}

        {/* selection overlays */}
        <g pointerEvents="none">
          {selection.rooms.map((id) => {
            const r = roomsById.get(id);
            if (!r) return null;
            return (
              <rect
                key={`sel-${id}`}
                x={X(r.x)}
                y={Y(r.y)}
                width={px(r.w)}
                height={px(r.h)}
                fill="rgba(226,61,40,0.08)"
                stroke={RED}
                strokeWidth={3}
                strokeDasharray="7 4"
              />
            );
          })}
        </g>
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
        {multi && (
          <text x={10} y={20} fontSize={12} fontWeight={700} fill={RED} letterSpacing={2}>
            MULTI-SELECT — click objects, Esc to clear
          </text>
        )}
      </svg>
    </div>
  );
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
  const size = Math.max(7, Math.min(13, Math.min(wPx / (name.length * 0.68), hPx / 3)));
  const dims = autoDims(room);
  const showDims = dims && hPx > size * 2.9 && wPx > dims.length * size * 0.58;
  const cx = X(room.x) + wPx / 2;
  const cy = Y(room.y) + hPx / 2;
  return (
    <g pointerEvents="none">
      <text className="label-name" x={cx} y={showDims ? cy - 2 : cy + size / 3} fontSize={size} textAnchor="middle" fill={INK}>
        {name}
      </text>
      {showDims && (
        <text x={cx} y={cy + size} fontSize={size * 0.82} textAnchor="middle" fill="#74747a">
          {dims}
        </text>
      )}
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
  const vp = viewport;
  void vp;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const attach = (el: SVGCircleElement | null, which: 0 | 1) => {
      if (!el) return;
      const behavior = drag<SVGCircleElement, unknown>().on('drag', (event) => {
        const [mx, my] = pointer(event.sourceEvent as PointerEvent, svg);
        // convert px back to metres along the wall axis
        const metre = vert ? (my - Y(0)) / PX_PER_M : (mx - X(0)) / PX_PER_M;
        const t = snap(absToT(wall, metre));
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
