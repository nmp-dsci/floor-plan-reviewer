import { useCallback, useEffect, useRef, useState } from 'react';
import { api, subscribe } from '../api';
import ChangeList from '../components/ChangeList';
import ContextBar from '../components/ContextBar';
import Inspector from '../components/Inspector';
import PlanCanvas from '../components/PlanCanvas';
import Register from '../components/Register';
import type { Op } from '../editing';
import { applyOpsPreview, describeOps, touchedIds } from '../editing';
import type {
  PlanGeometry,
  QueuedComment,
  RegisterHunk,
  Review as ReviewT,
  Selection,
  Tool,
  VersionDetail,
} from '../types';
import { emptySelection } from '../types';

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
  const [selection, setSelection] = useState<Selection>(emptySelection());
  const [tool, setTool] = useState<Tool>('select');
  const [pending, setPending] = useState<Op[]>([]);
  const [queue, setQueue] = useState<QueuedComment[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(queueKey(reviewId)) || '[]');
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'busy' | 'error' | 'ok'; text: string } | null>(null);
  const currentNRef = useRef<number | null>(null);
  currentNRef.current = currentN;

  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  useEffect(() => {
    localStorage.setItem(queueKey(reviewId), JSON.stringify(queue));
  }, [queue, reviewId]);

  const loadReview = useCallback(
    async (jumpToHead: boolean) => {
      const r = await api.review(reviewId);
      setReview(r);
      const target = jumpToHead || currentNRef.current === null ? r.head_n : currentNRef.current;
      if (target !== null) setCurrentN(target);
      // all registers in one round-trip (no N+1)
      const regs = new Map<number, RegisterHunk[]>();
      try {
        for (const { n, register } of await api.registers(reviewId)) regs.set(n, register);
      } catch {
        /* older backend — registers arrive per-version below */
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
        } else if (ev.type === 'job.error') {
          setBusy(false);
          setBanner({ kind: 'error', text: `Agent failed: ${ev.error}` });
        }
      }),
    [reviewId, loadReview, onVersionAdded],
  );

  if (!review || currentN === null || !detail) {
    return <div className="banner">Loading review…</div>;
  }

  const head = review.head_n ?? 0;
  const atHead = currentN === head;
  const allHunks = review.versions
    .filter((v) => v.n > 0 && v.n <= currentN)
    .flatMap((v) => (registers.get(v.n) ?? []).map((hunk) => ({ version: v.n, hunk })))
    .reverse();

  // preview geometry with any pending human ops applied
  const previewGeo = pending.length > 0 ? applyOpsPreview(detail.geometry, pending) : detail.geometry;
  const pendingMarks = touchedIds(pending);

  const queueOps = (ops: Op[]) => {
    setPending((p) => [...p, ...ops]);
    setSelection(emptySelection());
    setTool('select');
  };

  const applyEdits = () => {
    if (pending.length === 0) return;
    setBusy(true);
    setBanner({ kind: 'busy', text: 'Applying your edits…' });
    api
      .applyEdits(reviewId, head, pending, describeOps(pending))
      .then((res) => {
        setBusy(false);
        setPending([]);
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

  return (
    <>
      <ContextBar
        review={review}
        currentN={currentN}
        mode={mode}
        onVersion={(n) => {
          setCurrentN(n);
          setPending([]);
          setSelection(emptySelection());
        }}
        onMode={setMode}
        onRefreshComps={() =>
          api
            .refreshComps(reviewId)
            .then(() => loadReview(false))
            .catch((e) => setBanner({ kind: 'error', text: friendly(e) }))
        }
      />

      {banner && <div className={`banner ${banner.kind === 'ok' ? '' : banner.kind}`}>{banner.text}</div>}

      <div className="grid">
        <div>
          <div className="card">
            <h2>
              <span>Plan canvas</span>
              <small>
                {atHead
                  ? 'click to select · drag to move · handles to resize · edits batch until you apply'
                  : 'read-only — jump to head to edit'}
              </small>
            </h2>
            <PlanCanvas
              geometry={previewGeo}
              original={original}
              mode={mode}
              selection={selection}
              onSelectionChange={setSelection}
              interactive={atHead}
              tool={tool}
              onTool={setTool}
              onOps={queueOps}
              pendingIds={pendingMarks}
            />
            {mode === 'delta' && (
              <div className="hint">
                <span style={{ color: 'var(--green)' }}>■ added</span> ·{' '}
                <span style={{ color: 'var(--red)' }}>□ removed</span> ·{' '}
                <span style={{ color: 'var(--amber)' }}>□ modified</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <h2>
              <span>Inspector</span>
              <small>direct edits — no agent, instant</small>
            </h2>
            <Inspector
              geometry={detail.geometry}
              selection={selection}
              pending={pending}
              busy={busy}
              atHead={atHead}
              tool={tool}
              onTool={setTool}
              onOps={queueOps}
              onRemovePending={(i) => setPending((p) => p.filter((_, idx) => idx !== i))}
              onApply={applyEdits}
              onDiscard={() => {
                setPending([]);
                setSelection(emptySelection());
              }}
            />
          </div>

          <div className="card">
            <h2>
              <span>Ask the agent</span>
              <small>comments queue locally — nothing sends until you press send</small>
            </h2>
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
          </div>

          <div className="card">
            <h2>
              <span>Change register</span>
              <small>git-style, generated from the geometry diff</small>
            </h2>
            <Register hunks={allHunks} />
          </div>

          <div className="card">
            <h2>
              <span>Rent evidence</span>
              <small>{review.comps.length} live comp{review.comps.length === 1 ? '' : 's'}</small>
            </h2>
            <div className="body">
              {review.comps.length === 0 && (
                <span style={{ color: 'var(--faint)', fontSize: 13 }}>No comps recorded yet.</span>
              )}
              <ul className="comps">
                {review.comps.map((c, i) => (
                  <li key={i}>
                    <b>${c.rent_per_week}/wk</b> — {c.address} ({c.config}) ·{' '}
                    <span style={{ color: 'var(--faint)' }}>{c.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
      <footer>
        Concept proposals — not architectural, planning, or financial advice. Envelope is immutable;
        every edit — human or agent — is validated before it lands.
      </footer>
    </>
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
