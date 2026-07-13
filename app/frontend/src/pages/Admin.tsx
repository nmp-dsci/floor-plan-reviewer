import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { CheckCtx } from '../features';
import { FEATURES } from '../features';
import type { Op } from '../editing';

type Status = { state: 'pass'; ms: number } | { state: 'fail'; error: string } | { state: 'e2e' } | { state: 'running' };

interface StoredRun {
  ts: string;
  results: Record<string, { state: string; ms?: number; error?: string }>;
}

const STORE_KEY = 'fps-feature-checks';

export default function Admin() {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const stored: StoredRun = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (stored) {
        setLastRun(stored.ts);
        const s: Record<string, Status> = {};
        for (const [id, r] of Object.entries(stored.results)) {
          s[id] =
            r.state === 'pass'
              ? { state: 'pass', ms: r.ms ?? 0 }
              : r.state === 'fail'
                ? { state: 'fail', error: r.error ?? '' }
                : { state: 'e2e' };
        }
        setStatuses(s);
      }
    } catch {
      /* no stored run */
    }
  }, []);

  const counts = useMemo(() => {
    let pass = 0;
    let fail = 0;
    for (const f of FEATURES) {
      const s = statuses[f.id];
      if (s?.state === 'pass') pass++;
      else if (s?.state === 'fail') fail++;
    }
    return { pass, fail };
  }, [statuses]);

  const runAll = async () => {
    setRunning(true);
    setError('');
    const next: Record<string, Status> = {};
    for (const f of FEATURES) if (f.kind === 'gesture') next[f.id] = { state: 'e2e' };
    setStatuses({ ...next });

    let sandboxId = '';
    try {
      const sb = await api.createSandbox();
      sandboxId = sb.review_id;
      const ctx: CheckCtx = {
        reviewId: sandboxId,
        head: async () => {
          const r = await api.review(sandboxId);
          const n = r.head_n ?? 0;
          const d = await api.version(sandboxId, n);
          return { n, geometry: d.geometry };
        },
        edits: async (ops: Op[], title: string) => {
          const r = await api.review(sandboxId);
          return api.applyEdits(sandboxId, r.head_n ?? 0, ops, title);
        },
        editsExpectError: async (ops: Op[], status: number) => {
          const r = await api.review(sandboxId);
          try {
            await api.applyEdits(sandboxId, r.head_n ?? 0, ops, 'expect-reject');
          } catch (e) {
            if (String(e).includes(`${status}`)) return;
            throw new Error(`expected ${status}, got: ${String(e).slice(0, 120)}`);
          }
          throw new Error(`expected ${status}, but the edit was accepted`);
        },
      };

      for (const f of FEATURES) {
        if (!f.check) continue;
        setStatuses((s) => ({ ...s, [f.id]: { state: 'running' } }));
        const t0 = performance.now();
        try {
          await f.check(ctx);
          next[f.id] = { state: 'pass', ms: Math.round(performance.now() - t0) };
        } catch (e) {
          next[f.id] = { state: 'fail', error: String(e).replace(/^Error:\s*/, '').slice(0, 200) };
        }
        setStatuses((s) => ({ ...s, [f.id]: next[f.id] }));
      }
    } catch (e) {
      setError(`Check run aborted: ${String(e).slice(0, 200)}`);
    } finally {
      if (sandboxId) {
        try {
          await api.deleteSandbox(sandboxId);
        } catch {
          /* swept on next backend start */
        }
      }
      const ts = new Date().toLocaleString();
      setLastRun(ts);
      const results: StoredRun['results'] = {};
      for (const [id, s] of Object.entries(next)) {
        results[id] =
          s.state === 'pass'
            ? { state: 'pass', ms: s.ms }
            : s.state === 'fail'
              ? { state: 'fail', error: s.error }
              : { state: 'e2e' };
      }
      localStorage.setItem(STORE_KEY, JSON.stringify({ ts, results } satisfies StoredRun));
      setRunning(false);
    }
  };

  const groups = [...new Set(FEATURES.map((f) => f.group))];

  return (
    <>
      <header className="site">
        <div className="kicker">floor-plan studio · feature checks</div>
        <h1>Feature Checks</h1>
        <div className="sub">
          Every plan-canvas capability, how the human and the AI each use it, and a live check that
          proves it still works. Checks run against a throwaway sandbox review through the same
          validated <code>/edits</code> pipeline both authors share — your data is never touched.
          Gesture rows are covered by the Playwright e2e matrix (<code>make -C app e2e</code>).
        </div>
      </header>
      {error && <div className="banner error">{error}</div>}
      <div className="card">
        <h2>
          <span>Plan-canvas parity matrix</span>
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 12 }}>
              <span className="up">{counts.pass} PASS</span>
              {' · '}
              <span className={counts.fail ? 'down' : ''}>{counts.fail} FAIL</span>
              {lastRun ? ` · last run ${lastRun}` : ' · never run'}
            </span>
            <button className="primary" disabled={running} onClick={runAll}>
              {running ? 'Running…' : 'Run all checks'}
            </button>
          </span>
        </h2>
        <div className="tbl-scroll" style={{ overflowX: 'auto' }}>
          <table className="list checks">
            <thead>
              <tr>
                <th style={{ width: '18%' }}>Feature</th>
                <th style={{ width: '32%' }}>Human</th>
                <th style={{ width: '28%' }}>AI</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows
                  key={g}
                  group={g}
                  statuses={statuses}
                  expanded={expanded}
                  onExpand={(id) => setExpanded(expanded === id ? null : id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <footer>
        The registry lives in <code>frontend/src/features.ts</code> — any new canvas capability must
        add a row there, or it shows up here as untested.
      </footer>
    </>
  );
}

function GroupRows({
  group,
  statuses,
  expanded,
  onExpand,
}: {
  group: string;
  statuses: Record<string, Status>;
  expanded: string | null;
  onExpand: (id: string) => void;
}) {
  const rows = FEATURES.filter((f) => f.group === group);
  return (
    <>
      <tr className="group">
        <td colSpan={4}>{group}</td>
      </tr>
      {rows.map((f) => {
        const s = statuses[f.id];
        return (
          <FeatureRow
            key={f.id}
            id={f.id}
            feature={f.feature}
            human={f.human}
            ai={f.ai}
            example={f.example}
            status={s}
            expanded={expanded === f.id}
            onExpand={() => onExpand(f.id)}
          />
        );
      })}
    </>
  );
}

function FeatureRow({
  id,
  feature,
  human,
  ai,
  example,
  status,
  expanded,
  onExpand,
}: {
  id: string;
  feature: string;
  human: string;
  ai: string;
  example: string;
  status?: Status;
  expanded: boolean;
  onExpand: () => void;
}) {
  return (
    <>
      <tr className="click" data-feature={id} onClick={onExpand}>
        <td>
          <b>{feature}</b>
        </td>
        <td>{human}</td>
        <td>{ai}</td>
        <td>
          {!status && <span className="chip dim">not run</span>}
          {status?.state === 'running' && <span className="chip amber">running…</span>}
          {status?.state === 'pass' && (
            <span className="checkstat pass">PASS {status.ms >= 1 ? `${(status.ms / 1000).toFixed(1)}s` : ''}</span>
          )}
          {status?.state === 'fail' && <span className="checkstat fail">FAIL ▸</span>}
          {status?.state === 'e2e' && (
            <span className="chip ink" title="gesture — covered by the Playwright e2e matrix">
              e2e
            </span>
          )}
        </td>
      </tr>
      {(expanded || status?.state === 'fail') && (
        <tr className="example-row">
          <td colSpan={4}>
            <span className="mono">example: {example}</span>
            {status?.state === 'fail' && <span className="mono down"> — {status.error}</span>}
          </td>
        </tr>
      )}
    </>
  );
}
