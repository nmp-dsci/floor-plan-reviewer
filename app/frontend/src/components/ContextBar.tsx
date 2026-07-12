import { api } from '../api';
import type { Review } from '../types';

interface Props {
  review: Review;
  currentN: number;
  mode: 'proposed' | 'delta';
  onVersion: (n: number) => void;
  onMode: (m: 'proposed' | 'delta') => void;
  onRefreshComps: () => void;
}

export default function ContextBar({ review, currentN, mode, onVersion, onMode, onRefreshComps }: Props) {
  const head = review.head_n ?? 0;
  const headV = review.versions[review.versions.length - 1];
  const baseline = review.baseline_per_week;
  const proposed = headV ? headV.rent.proposed_per_week : baseline;
  const uplift = proposed - baseline;
  const current = review.versions.find((v) => v.n === currentN);

  return (
    <div className="ctxbar-wrap">
      <div className="ctxbar">
        <span className="addr">
          {review.plan.address || review.plan.slug} — v{String(currentN).padStart(2, '0')}
        </span>
        <span className="cfg">{current?.config}</span>
        <span className="rent">
          <span className="mono">${baseline.toFixed(0)}/wk</span>
          <span className="arrow">→</span>
          <b className="mono">${proposed.toFixed(0)}/wk</b>
          <span className={`mono ${uplift >= 0 ? 'up' : 'down'}`}>
            {uplift >= 0 ? '+' : '−'}${Math.abs(uplift).toFixed(0)}
          </span>
        </span>
      </div>
      <div className="subbar">
        <span className="versions">
          {review.versions.map((v) => (
            <button
              key={v.n}
              className={v.n === currentN ? 'active' : ''}
              title={`$${v.rent.proposed_per_week.toFixed(0)}/wk · ${v.config}`}
              onClick={() => onVersion(v.n)}
            >
              v{String(v.n).padStart(2, '0')}
            </button>
          ))}
        </span>
        <span className="tabs">
          <button className={mode === 'proposed' ? 'active' : ''} onClick={() => onMode('proposed')}>
            Proposed
          </button>
          <button className={mode === 'delta' ? 'active' : ''} onClick={() => onMode('delta')}>
            Delta
          </button>
        </span>
        {currentN !== head && (
          <span className="readonly">
            read-only — viewing v{String(currentN).padStart(2, '0')} of v{String(head).padStart(2, '0')}
            <button className="ghost" onClick={() => onVersion(head)}>
              jump to head
            </button>
          </span>
        )}
        <span className="acts">
          <a href={api.exportUrl(review.review_id, currentN)} target="_blank" rel="noreferrer">
            ⤓ PNG
          </a>
          <a href={api.summaryUrl(review.review_id)} target="_blank" rel="noreferrer">
            ⤓ SUMMARY.md
          </a>
          <button className="linklike" onClick={onRefreshComps}>
            refresh comps
          </button>
        </span>
      </div>
    </div>
  );
}
