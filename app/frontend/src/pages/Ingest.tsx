import { useState } from 'react';
import { api } from '../api';
import LevelTabs from '../components/LevelTabs';
import PlanCanvas from '../components/PlanCanvas';
import { levelGeometry, planLevels } from '../geometry';
import type { PlanGeometry } from '../types';
import { emptySelection } from '../types';

const STEPS = [
  { n: 1, title: 'Read the plan', blurb: 'We detect rooms, walls and dimensions from your image.' },
  { n: 2, title: 'Check the rooms', blurb: 'Compare the detected rooms with your image side by side.' },
  { n: 3, title: 'Set current rent', blurb: 'Tell us today’s weekly rent, then start the review.' },
] as const;

function Stepper({ active }: { active: number }) {
  return (
    <div className="ingest-steps">
      {STEPS.map((s) => (
        <div
          key={s.n}
          className={`ingest-step${s.n === active ? ' on' : ''}${s.n < active ? ' done' : ''}`}
        >
          <div className="n mono">{s.n < active ? '✓' : s.n}</div>
          <div className="t">{s.title}</div>
          <div className="b">{s.blurb}</div>
        </div>
      ))}
    </div>
  );
}

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
  const [activeLevel, setActiveLevel] = useState('');

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
          <a href="#/">floor-plan studio</a> · read a plan
        </div>
        <h1>Read your floor plan</h1>
        <div className="sub">
          We turn your listing image into an editable plan, then you can propose changes that lift
          the weekly rent — all within the existing building envelope.
        </div>
      </header>

      <Stepper active={draft ? 2 : 1} />

      {error && <div className="banner error">{error}</div>}

      {!draft && (
        <div className="card">
          <h2>Step 1 — read the plan</h2>
          <div className="body">
            <div className="ingest-preview">
              <img src={api.planImageUrl(planId)} alt="Uploaded floor plan" />
            </div>
            <button className="primary" onClick={run} disabled={running}>
              {running ? 'Reading your plan… (30–90s)' : 'Read my floor plan'}
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="grid">
          <div className="card">
            <h2>
              <span>Step 2 — check the rooms</span>
              <small>your image ↔ what we read</small>
            </h2>
            <div className="ingest-compare">
              <figure>
                <img src={api.planImageUrl(planId)} alt="Uploaded floor plan" />
                <figcaption>Your image</figcaption>
              </figure>
              <figure>
                {(() => {
                  const levels = planLevels(draft.geometry);
                  const active = levels.some((l) => l.id === activeLevel)
                    ? activeLevel
                    : (levels[0]?.id ?? 'level-1');
                  return (
                    <>
                      <LevelTabs geometry={draft.geometry} active={active} onChange={setActiveLevel} />
                      <PlanCanvas
                        geometry={levelGeometry(draft.geometry, active)}
                        mode="proposed"
                        selection={emptySelection()}
                        onSelectionChange={() => undefined}
                        interactive={false}
                      />
                    </>
                  );
                })()}
                <figcaption>What we read</figcaption>
              </figure>
            </div>
          </div>
          <div>
            <div className="card">
              <h2>Step 3 — set the rent &amp; start</h2>
              <div className="body">
                {draft.errors.length > 0 && (
                  <div className="banner error">
                    We couldn’t read this cleanly — fix upstream before starting: {draft.errors.join('; ')}
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
                  <label>Current weekly rent (AUD)</label>
                  <input value={baseline} onChange={(e) => setBaseline(e.target.value)} />
                </div>
                <button
                  className="primary"
                  onClick={approve}
                  disabled={approving || draft.errors.length > 0}
                >
                  {approving ? 'Creating review…' : 'Start the review'}
                </button>
                <button className="ghost" style={{ marginLeft: 8 }} onClick={run} disabled={running}>
                  read again
                </button>
                <div className="note" style={{ marginTop: 10 }}>
                  You can rename rooms and fix anything we misread once the review opens.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
