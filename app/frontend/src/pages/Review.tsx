import { useCallback, useEffect, useRef, useState } from 'react';
import { api, subscribe } from '../api';
import CanvasStage from '../components/CanvasStage';
import ChangeList from '../components/ChangeList';
import Coach from '../components/Coach';
import ContextBar from '../components/ContextBar';
import type { DockTab } from '../components/Dock';
import Dock from '../components/Dock';
import Inspector from '../components/Inspector';
import LevelTabs from '../components/LevelTabs';
import PlanCanvas from '../components/PlanCanvas';
import Register from '../components/Register';
import RentPanel from '../components/RentPanel';
import ReviewStrip from '../components/ReviewStrip';
import ShortcutSheet from '../components/ShortcutSheet';
import { envelopeForLevel, levelGeometry, planLevels, viewport } from '../geometry';
import type { Op, PendingEntry } from '../editing';
import {
  applyOpsPreview,
  describeOps,
  isPendingId,
  newPid,
  placeCopy,
  pvId,
  removePendingObject,
  rewritePendingObject,
  touchedIds,
  wallMoveOps,
} from '../editing';
import type {
  Fixture,
  OpeningType,
  PlanGeometry,
  QueuedComment,
  RegisterHunk,
  Review as ReviewT,
  Room,
  Selection,
  Tool,
  VersionDetail,
} from '../types';
import { emptySelection, hasSelection } from '../types';

type Clipboard =
  | { kind: 'room'; data: Room }
  | { kind: 'fixture'; data: Fixture }
  | { kind: 'opening'; data: { wallId: string; type: OpeningType; t0: number; t1: number } }
  | null;

interface Props {
  reviewId: string;
  onBusyChange?: (busy: boolean) => void;
  onVersionAdded?: () => void;
}

const queueKey = (id: string) => `fps-queue-${id}`;

export default function Review({ reviewId, onBusyChange, onVersionAdded }: Props) {
  const [review, setReview] = useState<ReviewT | null>(null);
  const [currentN, setCurrentN] = useState<number | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [original, setOriginal] = useState<PlanGeometry | null>(null);
  const [registers, setRegisters] = useState<Map<number, RegisterHunk[]>>(new Map());
  const [mode, setMode] = useState<'proposed' | 'delta'>('proposed');
  const [activeLevel, setActiveLevel] = useState<string>('');
  const [selection, setSelection] = useState<Selection>(emptySelection());
  const [tool, setTool] = useState<Tool>('select');
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [queue, setQueue] = useState<QueuedComment[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(queueKey(reviewId)) || '[]');
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false);
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>('edit');
  const [showSheet, setShowSheet] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'busy' | 'error' | 'ok'; text: string } | null>(null);
  const currentNRef = useRef<number | null>(null);
  currentNRef.current = currentN;

  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  // selecting an object raises the EDIT tab (direct-edit lane); the AGENT tab is
  // reached manually and carries a queued-comments badge.
  useEffect(() => {
    if (hasSelection(selection)) setDockTab('edit');
  }, [selection]);

  // `?` toggles the shortcut sheet (F11); Esc closes it. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === '?') {
        e.preventDefault();
        setShowSheet((s) => !s);
      } else if (e.key === 'Escape') {
        setShowSheet(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    localStorage.setItem(queueKey(reviewId), JSON.stringify(queue));
  }, [queue, reviewId]);

  const loadReview = useCallback(
    async (jumpToHead: boolean) => {
      const r = await api.review(reviewId);
      setReview(r);
      const target = jumpToHead || currentNRef.current === null ? r.head_n : currentNRef.current;
      if (target !== null) setCurrentN(target);
      const regs = new Map<number, RegisterHunk[]>();
      try {
        for (const { n, register } of await api.registers(reviewId)) regs.set(n, register);
      } catch {
        /* older backend */
      }
      setRegisters(regs);
      const v0 = r.versions.find((v) => v.n === 0);
      if (v0) {
        const d0 = await api.version(reviewId, 0);
        setOriginal(d0.geometry);
      }
    },
    [reviewId],
  );

  useEffect(() => {
    loadReview(true).catch((e) => setBanner({ kind: 'error', text: friendly(e) }));
  }, [loadReview]);

  useEffect(() => {
    if (currentN === null) return;
    api
      .version(reviewId, currentN)
      .then(setDetail)
      .catch((e) => setBanner({ kind: 'error', text: friendly(e) }));
  }, [reviewId, currentN]);

  useEffect(
    () =>
      subscribe(reviewId, (ev) => {
        if (ev.type === 'job.status' && ev.status === 'running') {
          setBusy(true);
          setBanner({ kind: 'busy', text: 'Agent is working on your changes…' });
        } else if (ev.type === 'version.ready') {
          setBusy(false);
          setQueue([]);
          setPending([]);
          setSelection(emptySelection());
          setBanner({
            kind: 'ok',
            text: `v${String(ev.n).padStart(2, '0')} is ready${ev.warnings.length ? ` — ${ev.warnings.length} warning(s)` : ''}.`,
          });
          loadReview(true).catch(() => undefined);
          onVersionAdded?.();
        } else if (ev.type === 'version.deleted') {
          setBusy(false);
          setPending([]);
          setSelection(emptySelection());
          setBanner({
            kind: 'ok',
            text: `v${String(ev.n).padStart(2, '0')} deleted — v${String(ev.head_n).padStart(2, '0')} is now editable.`,
          });
          loadReview(true).catch(() => undefined);
          onVersionAdded?.();
        } else if (ev.type === 'job.error') {
          setBusy(false);
          setBanner({ kind: 'error', text: `Agent failed: ${ev.error}` });
        }
      }),
    [reviewId, loadReview, onVersionAdded],
  );

  // Undo: pop the last pending edit if any, else roll back the head version.
  // Shared by ⌘Z and the on-canvas Undo control.
  const handleUndo = useCallback(() => {
    if (pending.length > 0) {
      if (busy) return;
      setPending((p) => p.slice(0, -1));
      return;
    }
    const h = review?.head_n ?? 0;
    if (!review || currentN !== review.head_n || h <= 0 || busy) return;
    setBusy(true);
    setBanner({ kind: 'busy', text: `Undoing v${String(h).padStart(2, '0')}…` });
    api
      .deleteVersion(reviewId, h)
      .then((res) => {
        setBusy(false);
        setBanner({
          kind: 'ok',
          text: `Undid v${String(res.deleted).padStart(2, '0')} — v${String(res.head_n).padStart(2, '0')} is editable.`,
        });
        return loadReview(true);
      })
      .then(() => onVersionAdded?.())
      .catch((e2) => {
        setBusy(false);
        setBanner({ kind: 'error', text: friendly(e2) });
      });
  }, [pending, review, currentN, busy, reviewId, loadReview, onVersionAdded]);

  // Keyboard: Delete removes selection; Cmd/Ctrl+C copies; +V pastes; +Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (review === null || currentN !== review.head_n || !detail) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!hasSelection(selection)) return;
        e.preventDefault();
        // pending objects: drop their originating op; real objects: queue remove ops
        let next = pending;
        for (const id of selection.rooms.filter(isPendingId)) next = removePendingObject(next, id);
        for (const id of selection.fixtures.filter(isPendingId)) next = removePendingObject(next, id);
        for (const o of selection.openings.filter((o) => isPendingId(o.id)))
          next = removePendingObject(next, o.id);
        const removeOps: Op[] = [
          ...selection.rooms.filter((id) => !isPendingId(id)).map((id) => ({ op: 'remove_room', room_id: id }) as Op),
          ...selection.fixtures
            .filter((id) => !isPendingId(id))
            .map((id) => ({ op: 'remove_fixture', fixture_id: id }) as Op),
          ...selection.openings
            .filter((o) => !isPendingId(o.id))
            .map((o) => ({ op: 'remove_opening', opening_id: o.id }) as Op),
          ...selection.walls.map(
            (w) => ({ op: 'remove_wall_chunk', wall_id: w.id, t0: w.t0, t1: w.t1 }) as Op,
          ),
        ];
        setPending([...next, ...removeOps.map((op) => ({ pid: newPid(), op }))]);
        setSelection(emptySelection());
        return;
      }

      if (mod && key === 'c') {
        const geo = previewGeo;
        if (selection.rooms.length === 1) {
          const r = geo.rooms.find((r) => r.id === selection.rooms[0]);
          if (r) {
            setClipboard({ kind: 'room', data: r });
            e.preventDefault();
          }
        } else if (selection.fixtures.length === 1) {
          const f = geo.fixtures.find((f) => f.id === selection.fixtures[0]);
          if (f) {
            setClipboard({ kind: 'fixture', data: f });
            e.preventDefault();
          }
        } else if (selection.openings.length === 1) {
          const os = selection.openings[0];
          const w = geo.walls.find((w) => w.id === os.wallId);
          const o = w?.openings.find((o) => o.id === os.id);
          if (w && o) {
            setClipboard({ kind: 'opening', data: { wallId: w.id, type: o.type, t0: o.t0, t1: o.t1 } });
            e.preventDefault();
          }
        }
        return;
      }

      if (mod && key === 'v' && clipboard) {
        e.preventDefault();
        const lvls = planLevels(detail.geometry);
        const lv = lvls.some((l) => l.id === activeLevel) ? activeLevel : (lvls[0]?.id ?? 'level-1');
        const env = envelopeForLevel(detail.geometry, lv);
        if (clipboard.kind === 'room') {
          const r = clipboard.data;
          const at = placeCopy(r, env);
          queueOps([
            { op: 'add_room', name: `${r.name} copy`, kind: r.kind, x: at.x, y: at.y, w: r.w, h: r.h, fill: r.fill },
          ]);
        } else if (clipboard.kind === 'fixture') {
          const f = clipboard.data;
          const at = placeCopy(f, env, 0.1);
          queueOps([
            { op: 'add_fixture', x: at.x, y: at.y, w: f.w, h: f.h, label: f.label ? `${f.label} copy` : '' },
          ]);
        } else {
          const { wallId, type, t0, t1 } = clipboard.data;
          const len = t1 - t0;
          const gap = 0.06;
          let n0 = t1 + gap;
          let n1 = n0 + len;
          if (n1 > 1) {
            n1 = t0 - gap;
            n0 = n1 - len;
          }
          if (n0 >= 0 && n1 <= 1) {
            queueOps([{ op: 'add_opening', wall_id: wallId, t0: n0, t1: n1, type }]);
          } else {
            setBanner({ kind: 'error', text: 'No room on this wall to paste the opening — pick another wall.' });
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, currentN, review, detail, clipboard, pending, busy, reviewId, loadReview, onVersionAdded, activeLevel, handleUndo]);

  if (!review || currentN === null || !detail) {
    return <div className="banner">Loading review…</div>;
  }

  const head = review.head_n ?? 0;
  const atHead = currentN === head;
  const allHunks = review.versions
    .filter((v) => v.n > 0 && v.n <= currentN)
    .flatMap((v) => (registers.get(v.n) ?? []).map((hunk) => ({ version: v.n, hunk })))
    .reverse();

  // preview geometry with pending human ops applied — pv objects live here
  const previewGeo = pending.length > 0 ? applyOpsPreview(detail.geometry, pending) : detail.geometry;
  const pendingMarks = touchedIds(pending);

  // levels: storeys + detached structures. `active` is always a valid level id, so a
  // single-level plan (tabs hidden) still filters to its sole level transparently.
  const levels = planLevels(detail.geometry);
  const active = levels.some((l) => l.id === activeLevel) ? activeLevel : (levels[0]?.id ?? 'level-1');
  const canvasGeo = levelGeometry(previewGeo, active);
  const canvasOriginal = original ? levelGeometry(original, active) : null;
  const canvasVp = viewport(canvasGeo);
  const aspect = canvasVp.width / canvasVp.height;
  const canUndo = (pending.length > 0 || (atHead && head > 0)) && !busy;

  const changeLevel = (levelId: string) => {
    setActiveLevel(levelId);
    setSelection(emptySelection());
  };

  function queueOps(rawOps: Op[]) {
    // new rooms/fixtures land on the level currently being viewed
    const ops = rawOps.map((op) =>
      (op.op === 'add_room' || op.op === 'add_fixture') && !op.level ? { ...op, level: active } : op,
    );
    const entries = ops.map((op) => ({ pid: newPid(), op }));
    setPending((p) => [...p, ...entries]);
    // auto-select the created object so the inspector opens focused on its name
    const creator = entries.find(
      (e) => e.op.op === 'add_room' || e.op.op === 'add_fixture' || e.op.op === 'split_room',
    );
    if (creator) {
      const id = pvId(creator.pid);
      if (creator.op.op === 'add_fixture') setSelection({ ...emptySelection(), fixtures: [id] });
      else setSelection({ ...emptySelection(), rooms: [id] });
    } else {
      setSelection(emptySelection());
    }
    setTool('select');
  }

  const rewritePending = (pvObjectId: string, patch: Record<string, number | string>) => {
    setPending((p) => rewritePendingObject(p, pvObjectId, patch));
  };

  const onWallMove = (wallId: string, d: number) => {
    const wall = previewGeo.walls.find((w) => w.id === wallId);
    if (!wall) return;
    const res = wallMoveOps(previewGeo, wall, d);
    if ('error' in res) {
      setBanner({ kind: 'error', text: `Wall can’t move: ${res.error}` });
      return;
    }
    setPending((p) => [...p, ...res.ops.map((op) => ({ pid: newPid(), op }))]);
    setSelection(emptySelection());
  };

  const applyEdits = () => {
    if (pending.length === 0) return;
    const ops = pending.map((e) => e.op);
    setBusy(true);
    setBanner({ kind: 'busy', text: 'Applying your edits…' });
    api
      .applyEdits(reviewId, head, ops, describeOps(ops), active)
      .then((res) => {
        setBusy(false);
        setPending([]);
        setSelection(emptySelection());
        setBanner({
          kind: 'ok',
          text: `v${String(res.n).padStart(2, '0')} saved${res.warnings.length ? ` — ${res.warnings.length} warning(s)` : ''}.`,
        });
        return loadReview(true);
      })
      .then(() => onVersionAdded?.())
      .catch((e) => {
        setBusy(false);
        setBanner({ kind: 'error', text: friendly(e) });
      });
  };

  const sendComments = () => {
    setBusy(true);
    setBanner({ kind: 'busy', text: 'Submitting to the agent…' });
    api.submitComments(reviewId, head, queue).catch((e) => {
      setBusy(false);
      setBanner({ kind: 'error', text: friendly(e) });
    });
  };

  const bookmarkVersion = (n: number) => {
    api
      .bookmarkVersion(reviewId, n)
      .then(() => loadReview(false))
      .catch((e) => setBanner({ kind: 'error', text: friendly(e) }));
  };

  const deleteVersion = (n: number) => {
    setBusy(true);
    setBanner({ kind: 'busy', text: `Deleting v${String(n).padStart(2, '0')}…` });
    api
      .deleteVersion(reviewId, n)
      .then((res) => {
        setBusy(false);
        setBanner({
          kind: 'ok',
          text: `v${String(res.deleted).padStart(2, '0')} deleted — v${String(res.head_n).padStart(2, '0')} is now editable.`,
        });
        return loadReview(true);
      })
      .then(() => onVersionAdded?.())
      .catch((e) => {
        setBusy(false);
        setBanner({ kind: 'error', text: friendly(e) });
      });
  };

  const changeVersion = (n: number) => {
    setCurrentN(n);
    setPending([]);
    setSelection(emptySelection());
  };
  const refreshComps = () =>
    api
      .refreshComps(reviewId)
      .then(() => loadReview(false))
      .catch((e) => setBanner({ kind: 'error', text: friendly(e) }));

  return (
    <div className="ws">
      <ContextBar review={review} currentN={currentN} />

      {banner && <div className={`banner ${banner.kind === 'ok' ? '' : banner.kind}`}>{banner.text}</div>}

      <div className="ws-body">
        <div className="ws-canvas">
          <LevelTabs geometry={detail.geometry} active={active} onChange={changeLevel} />
          <CanvasStage aspect={aspect} onUndo={handleUndo} canUndo={canUndo}>
            <PlanCanvas
              geometry={canvasGeo}
              original={canvasOriginal}
              mode={mode}
              selection={selection}
              onSelectionChange={setSelection}
              interactive={atHead}
              tool={tool}
              onTool={setTool}
              onOps={queueOps}
              onRewrite={rewritePending}
              onWallMove={onWallMove}
              pendingIds={pendingMarks}
            />
          </CanvasStage>
          {mode === 'delta' && (
            <div className="delta-legend-float" role="img" aria-label="Delta legend: added, removed, modified">
              <span>
                <span className="g add">＋</span> Added
              </span>
              <span>
                <span className="g rem">−</span> Removed
              </span>
              <span>
                <span className="g mod">△</span> Modified
              </span>
            </div>
          )}
          <div className="ws-canvas-foot">
            {!atHead ? (
              <span className="tip">read-only — jump to the head version to edit</span>
            ) : mode === 'delta' ? (
              <span className="tip">comparing the original plan with the current proposal</span>
            ) : (
              <span className="tip">
                click to select · drag a room to reshape neighbours (Alt = free move) · walls drag
                sideways · edits batch until you apply
              </span>
            )}
            <button className="foot-help" onClick={() => setShowSheet(true)} title="Keyboard shortcuts">
              <span className="mono">?</span> shortcuts
            </button>
          </div>
        </div>

        <div className="ws-dock">
          <Dock
            tab={dockTab}
            onTab={setDockTab}
            panels={[
              {
                id: 'edit',
                label: 'Edit',
                node: (
                  <Inspector
                    geometry={canvasGeo}
                    selection={selection}
                    pending={pending}
                    busy={busy}
                    atHead={atHead}
                    tool={tool}
                    onTool={setTool}
                    onOps={queueOps}
                    onRewrite={rewritePending}
                    onRemovePending={(i) => setPending((p) => p.filter((_, idx) => idx !== i))}
                    onApply={applyEdits}
                    onDiscard={() => {
                      setPending([]);
                      setSelection(emptySelection());
                    }}
                  />
                ),
              },
              {
                id: 'agent',
                label: 'Agent',
                badge: queue.length,
                node: (
                  <ChangeList
                    selection={selection}
                    queue={queue}
                    busy={busy}
                    atHead={atHead}
                    onQueue={(c) => setQueue((q) => [...q, c])}
                    onRemove={(id) => setQueue((q) => q.filter((c) => c.id !== id))}
                    onSend={sendComments}
                    onClearSelection={() => setSelection(emptySelection())}
                  />
                ),
              },
              {
                id: 'history',
                label: 'History',
                node: (
                  <>
                    {allHunks.length > 1 && (
                      <div className="dock-subhead">
                        <span>Change register</span>
                        <button
                          className="ghost register-toggle"
                          onClick={() => setRegisterOpen((o) => !o)}
                        >
                          {registerOpen ? 'collapse ▲' : `expand all (${allHunks.length}) ▾`}
                        </button>
                      </div>
                    )}
                    <Register hunks={allHunks} open={registerOpen} />
                  </>
                ),
              },
              {
                id: 'rent',
                label: 'Rent',
                node: <RentPanel review={review} />,
              },
            ]}
          />
        </div>
      </div>

      <ReviewStrip
        review={review}
        currentN={currentN}
        head={head}
        mode={mode}
        busy={busy}
        onVersion={changeVersion}
        onMode={setMode}
        onBookmark={bookmarkVersion}
        onDeleteVersion={deleteVersion}
        onRefreshComps={refreshComps}
      />

      <Coach />
      {showSheet && <ShortcutSheet onClose={() => setShowSheet(false)} />}
    </div>
  );
}

function friendly(e: unknown): string {
  const msg = String(e);
  const m = msg.match(/^Error:\s*(\d{3}):\s*(.*)$/s);
  if (m) {
    const body = m[2].trim();
    return `${m[1]} — ${body.slice(0, 200)}`;
  }
  return msg.replace(/^Error:\s*/, '');
}
