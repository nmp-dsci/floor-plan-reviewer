import type { Review } from '../types';

/** The rent story — the product's whole point, promoted from a header line to a
 * panel: baseline → proposed meter against the live comps range, per-change $
 * contributions (only priced changes summed — no invented numbers), and an honest
 * stale-rent banner when the latest change hasn't been re-priced. */
export default function RentPanel({ review }: { review: Review }) {
  const baseline = review.baseline_per_week;
  const versions = review.versions;
  const headV = versions[versions.length - 1];
  const proposed = headV ? headV.rent.proposed_per_week : baseline;
  const uplift = proposed - baseline;
  const upliftPct = baseline > 0 ? Math.round((uplift / baseline) * 100) : 0;

  const comps = review.comps;
  const compRents = comps.map((c) => c.rent_per_week).filter((n) => n > 0);
  const compLo = compRents.length ? Math.min(...compRents) : null;
  const compHi = compRents.length ? Math.max(...compRents) : null;

  const scaleLo = Math.min(baseline, proposed) * 0.96;
  const scaleHi = Math.max(proposed, compHi ?? proposed) * 1.03;
  const pos = (v: number) =>
    scaleHi > scaleLo ? Math.max(0, Math.min(100, ((v - scaleLo) / (scaleHi - scaleLo)) * 100)) : 0;

  // per-change contributions (skip v0, which has none)
  const contributions = versions.flatMap((v) => v.changes.map((c) => ({ ...c, n: v.n })));
  // the latest change carries no re-priced rent → be honest about a stale estimate
  const stale = (headV?.changes ?? []).some((c) =>
    c.flags.some((f) => /re-assess|re-price|not re-assessed/i.test(f)),
  );

  const dollars = (n: number) => `$${Math.round(n).toLocaleString()}`;

  return (
    <div className="rent-panel">
      <div className="rent-head">
        <div className="kick">Estimated weekly rent</div>
        <div className="rent-big mono">
          {dollars(proposed)}
          <span className="unit">/wk</span>
          <span className={`delta ${uplift >= 0 ? 'up' : 'down'}`}>
            {uplift >= 0 ? '+' : '−'}
            {dollars(Math.abs(uplift))} · {uplift >= 0 ? '+' : '−'}
            {Math.abs(upliftPct)}%
          </span>
        </div>
      </div>

      <div className="rent-meter" aria-hidden="true">
        <div className="fill" style={{ width: `${pos(proposed)}%` }} />
        {compLo !== null && compHi !== null && (
          <div
            className="comps-band"
            style={{ left: `${pos(compLo)}%`, width: `${Math.max(1, pos(compHi) - pos(compLo))}%` }}
            title={`Live comps: ${dollars(compLo)}–${dollars(compHi)}/wk`}
          />
        )}
        <div className="tick" style={{ left: `${pos(baseline)}%` }} title={`Baseline ${dollars(baseline)}`} />
      </div>
      <div className="rent-scale mono">
        <span>baseline {dollars(baseline)}</span>
        {compLo !== null && compHi !== null ? (
          <span>
            comps {dollars(compLo)}–{dollars(compHi)}
          </span>
        ) : (
          <span className="faint">no comps yet</span>
        )}
      </div>

      {stale && (
        <div className="banner amber rent-stale">
          Rent estimate is out of date for the latest change — <strong>ask the agent to re-price</strong>{' '}
          from the Agent tab.
        </div>
      )}

      <div className="rent-contribs">
        <div className="kick">What moves the rent</div>
        {contributions.length === 0 && (
          <div className="faint" style={{ fontSize: 12.5 }}>
            No changes yet — this is the original plan at its baseline rent.
          </div>
        )}
        {contributions.map((c) => {
          const amt = c.rent_impact_per_week;
          return (
            <div className="contrib" key={`${c.n}-${c.id}`}>
              <span className="t">{c.title}</span>
              <span className={`amt mono ${amt > 0 ? 'up' : amt < 0 ? 'down' : 'zero'}`}>
                {amt > 0 ? '+' : amt < 0 ? '−' : ''}
                {amt === 0 ? 'pending' : dollars(Math.abs(amt))}
              </span>
            </div>
          );
        })}
      </div>

      <div className="rent-comps">
        <div className="kick">
          Rent evidence · {comps.length} live comp{comps.length === 1 ? '' : 's'}
        </div>
        {comps.length === 0 && (
          <div className="faint" style={{ fontSize: 12.5 }}>
            No comps recorded yet — use “refresh comps” below the canvas.
          </div>
        )}
        <ul className="comps">
          {comps.map((c, i) => (
            <li key={i}>
              <b className="mono">{dollars(c.rent_per_week)}/wk</b> — {c.address} ({c.config}) ·{' '}
              <span className="faint">{c.source}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rent-disclaimer">
        Rent figures come from live comparable listings only — never invented. Concept proposals, not
        architectural, planning, or financial advice.
      </div>
    </div>
  );
}
