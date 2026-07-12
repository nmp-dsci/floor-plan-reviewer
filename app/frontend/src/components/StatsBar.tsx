import type { Review } from '../types';

export default function StatsBar({ review, currentN }: { review: Review; currentN: number }) {
  const head = review.versions[review.versions.length - 1];
  const baseline = review.baseline_per_week;
  const uplift = head ? head.rent.proposed_per_week - baseline : 0;
  return (
    <div className="statline">
      <div className="stat">
        Baseline <b>${baseline.toFixed(0)}/wk</b>
      </div>
      {review.versions
        .filter((v) => v.n > 0)
        .map((v) => (
          <div key={v.n} className={`stat${v.n === currentN ? ' now' : ''}${v.n === review.head_n ? ' up' : ''}`}>
            v{String(v.n).padStart(2, '0')} <b>${v.rent.proposed_per_week.toFixed(0)}/wk</b>
            <span style={{ fontSize: 10 }}>{v.config}</span>
          </div>
        ))}
      <div className="stat up">
        Cumulative <b>{uplift >= 0 ? '+' : '−'}${Math.abs(uplift).toFixed(0)}/wk</b>
      </div>
    </div>
  );
}
