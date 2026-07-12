import { useState } from 'react';
import { api } from '../api';
import PlanCanvas from '../components/PlanCanvas';
import type { PlanGeometry } from '../types';
import { emptySelection } from '../types';

export default function Ingest({ planId }: { planId: string }) {
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<{
    geometry: PlanGeometry;
    notes: string[];
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [baseline, setBaseline] = useState('900');
  const [error, setError] = useState('');
  const [approving, setApproving] = useState(false);

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      setDraft(await api.ingest(planId));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const approve = async () => {
    if (!draft) return;
    setApproving(true);
    try {
      const { review_id } = await api.approve(planId, draft.geometry, Number(baseline) || 0);
      window.location.hash = `#/review/${review_id}`;
    } catch (e) {
      setError(String(e));
      setApproving(false);
    }
  };

  return (
    <>
      <header className="site">
        <div className="kicker">
          <a href="#/">floor-plan studio</a> · ingest
        </div>
        <h1>Vision ingestion</h1>
        <div className="sub">
          The vision agent (Claude) reads the uploaded image and drafts schema-v2 geometry. Review
          the draft, set the current weekly rent, then approve to open the review.
        </div>
      </header>
      {error && <div className="banner error">{error}</div>}
      {!draft && (
        <div className="card">
          <h2>Step 1 — extract geometry</h2>
          <div className="body">
            <button className="primary" onClick={run} disabled={running}>
              {running ? 'Vision agent reading the plan… (30–90s)' : 'Extract with vision agent'}
            </button>
          </div>
        </div>
      )}
      {draft && (
        <div className="grid">
          <div className="card">
            <h2>Draft geometry</h2>
            <PlanCanvas
              geometry={draft.geometry}
              mode="proposed"
              selection={emptySelection()}
              onSelectionChange={() => undefined}
              interactive={false}
            />
          </div>
          <div>
            <div className="card">
              <h2>Step 2 — confirm &amp; approve</h2>
              <div className="body">
                {draft.errors.length > 0 && (
                  <div className="banner error">
                    Validator errors — fix upstream before approving: {draft.errors.join('; ')}
                  </div>
                )}
                {draft.notes.length > 0 && (
                  <ul style={{ fontSize: 13, paddingLeft: 18 }}>
                    {draft.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
                <div className="field">
                  <label>Current weekly rent (AUD, baseline)</label>
                  <input value={baseline} onChange={(e) => setBaseline(e.target.value)} />
                </div>
                <button className="primary" onClick={approve} disabled={approving || draft.errors.length > 0}>
                  {approving ? 'Creating review…' : 'Approve → open review'}
                </button>
                <button className="ghost" style={{ marginLeft: 8 }} onClick={run} disabled={running}>
                  re-run extraction
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
