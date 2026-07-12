import { useCallback, useEffect, useRef, useState } from 'react';
import { api, subscribe } from '../api';
import ChangeList from '../components/ChangeList';
import PlanCanvas from '../components/PlanCanvas';
import Register from '../components/Register';
import StatsBar from '../components/StatsBar';
import type {
  PlanGeometry,
  QueuedComment,
  RegisterHunk,
  Review as ReviewT,
  Selection,
  VersionDetail,
} from '../types';
import { emptySelection } from '../types';

export default function Review({ reviewId }: { reviewId: string }) {
  const [review, setReview] = useState<ReviewT | null>(null);
  const [currentN, setCurrentN] = useState<number | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [original, setOriginal] = useState<PlanGeometry | null>(null);
  const [registers, setRegisters] = useState<Map<number, RegisterHunk[]>>(new Map());
  const [mode, setMode] = useState<'proposed' | 'delta'>('proposed');
  const [selection, setSelection] = useState<Selection>(emptySelection());
  const [queue, setQueue] = useState<QueuedComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'busy' | 'error' | 'ok'; text: string } | null>(null);
  const currentNRef = useRef<number | null>(null);
  currentNRef.current = currentN;

  const loadReview = useCallback(
    async (jumpToHead: boolean) => {
      const r = await api.review(reviewId);
      setReview(r);
      const target = jumpToHead || currentNRef.current === null ? r.head_n : currentNRef.current;
      if (target !== null) setCurrentN(target);
      // registers for every version we haven't fetched yet
      const regs = new Map<number, RegisterHunk[]>();
      for (const v of r.versions) {
        if (v.n === 0) continue;
        const d = await api.version(reviewId, v.n);
        regs.set(v.n, d.register);
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
    loadReview(true).catch((e) => setBanner({ kind: 'error', text: String(e) }));
  }, [loadReview]);

  useEffect(() => {
    if (currentN === null) return;
    api
      .version(reviewId, currentN)
      .then(setDetail)
      .catch((e) => setBanner({ kind: 'error', text: String(e) }));
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
          setBanner({
            kind: 'ok',
            text: `v${String(ev.n).padStart(2, '0')} is ready${ev.warnings.length ? ` — ${ev.warnings.length} warning(s)` : ''}.`,
          });
          loadReview(true).catch(() => undefined);
        } else if (ev.type === 'job.error') {
          setBusy(false);
          setBanner({ kind: 'error', text: `Agent failed: ${ev.error}` });
        }
      }),
    [reviewId, loadReview],
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

  const send = () => {
    setBusy(true);
    setBanner({ kind: 'busy', text: 'Submitting to the agent…' });
    api.submitComments(reviewId, head, queue).catch((e) => {
      setBusy(false);
      setBanner({ kind: 'error', text: String(e) });
    });
  };

  return (
    <>
      <header className="site">
        <div className="kicker">
          <a href="#/">floor-plan studio</a> · review
        </div>
        <h1>
          {review.plan.address || review.plan.slug} — v{String(currentN).padStart(2, '0')}
        </h1>
        <div className="sub">
          {detail.config} · click rooms or walls to select · long-press or shift-click for
          multi-select · drag the handles on a selected wall to pick a chunk
        </div>
        <StatsBar review={review} currentN={currentN} />
      </header>

      {banner && <div className={`banner ${banner.kind === 'ok' ? '' : banner.kind}`}>{banner.text}</div>}

      <div className="grid">
        <div>
          <div className="card">
            <h2>
              <span>Plan canvas</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="versions">
                  {review.versions.map((v) => (
                    <button
                      key={v.n}
                      className={v.n === currentN ? 'active' : ''}
                      onClick={() => setCurrentN(v.n)}
                    >
                      v{String(v.n).padStart(2, '0')}
                    </button>
                  ))}
                </span>
                <span className="tabs">
                  <button className={mode === 'proposed' ? 'active' : ''} onClick={() => setMode('proposed')}>
                    Proposed
                  </button>
                  <button className={mode === 'delta' ? 'active' : ''} onClick={() => setMode('delta')}>
                    Delta vs original
                  </button>
                </span>
              </span>
            </h2>
            <PlanCanvas
              geometry={detail.geometry}
              original={original}
              mode={mode}
              selection={selection}
              onSelectionChange={setSelection}
              interactive={atHead}
            />
            <div className="hint">
              <a href={api.exportUrl(reviewId, currentN)} target="_blank" rel="noreferrer">
                ⤓ export v{String(currentN).padStart(2, '0')} as PNG
              </a>
              {' · '}
              <a href={api.summaryUrl(reviewId)} target="_blank" rel="noreferrer">
                ⤓ SUMMARY.md
              </a>
              {mode === 'delta' && (
                <span>
                  {' '}
                  · <span style={{ color: 'var(--green)' }}>■ added</span> ·{' '}
                  <span style={{ color: 'var(--red)' }}>□ removed</span> ·{' '}
                  <span style={{ color: 'var(--amber)' }}>□ modified</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>
              <span>Change list</span>
              <small>comments queue locally — nothing sends until you press send</small>
            </h2>
            <ChangeList
              selection={selection}
              queue={queue}
              busy={busy}
              atHead={atHead}
              onQueue={(c) => setQueue((q) => [...q, c])}
              onRemove={(id) => setQueue((q) => q.filter((c) => c.id !== id))}
              onSend={send}
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
              <button
                className="ghost"
                onClick={() =>
                  api
                    .refreshComps(reviewId)
                    .then(() => loadReview(false))
                    .catch((e) => setBanner({ kind: 'error', text: String(e) }))
                }
              >
                refresh via web search
              </button>
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
        every agent edit is validated before it lands.
      </footer>
    </>
  );
}
