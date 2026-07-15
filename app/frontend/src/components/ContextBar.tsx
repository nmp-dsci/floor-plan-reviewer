import type { Review } from '../types';

interface Props {
  review: Review;
  currentN: number;
}

/** Top identity bar: address · configuration · areas · headline rent.
 * Version identity and the proposed/delta lens live in the bottom ReviewStrip;
 * the full rent story lives in the dock's RENT tab. */
export default function ContextBar({ review, currentN }: Props) {
  const baseline = review.baseline_per_week;
  const headV = review.versions[review.versions.length - 1];
  const proposed = headV ? headV.rent.proposed_per_week : baseline;
  const uplift = proposed - baseline;
  const current = review.versions.find((v) => v.n === currentN);
  const internal = current?.internal_area;
  const total = current?.total_area;
  // "size of opportunity": interior not yet assigned to habitable rooms
  const opportunity = internal !== undefined && total !== undefined ? total - internal : undefined;

  return (
    <div className="ctxbar-wrap">
      <div className="ctxbar">
        <span className="addr">
          {review.plan.address || review.plan.slug} — v{String(currentN).padStart(2, '0')}
        </span>
        <span className="cfg">{current?.config}</span>
        {internal !== undefined && total !== undefined && (
          <span className="areas" title="Habitable internal area vs the fixed envelope footprint">
            <span className="mono">
              <b>{internal.toFixed(0)}</b> m² internal
            </span>
            <span className="mono faintsep">/ {total.toFixed(0)} m² envelope</span>
            {opportunity !== undefined && opportunity > 0.5 && (
              <span
                className="mono opp"
                title={`The envelope allows ${total.toFixed(0)} m²; the plan uses ${internal.toFixed(0)} m². This much interior isn't yet assigned to habitable rooms.`}
              >
                {opportunity.toFixed(0)} m² headroom
              </span>
            )}
          </span>
        )}
        <span className="rent">
          <span className="mono">${baseline.toFixed(0)}/wk</span>
          <span className="arrow">→</span>
          <b className="mono">${proposed.toFixed(0)}/wk</b>
          <span className={`mono ${uplift >= 0 ? 'up' : 'down'}`}>
            {uplift >= 0 ? '+' : '−'}${Math.abs(uplift).toFixed(0)}
          </span>
        </span>
      </div>
    </div>
  );
}
