import { api } from '../api';
import type { Review } from '../types';

interface Props {
  review: Review;
  currentN: number;
  head: number;
  mode: 'proposed' | 'delta';
  busy: boolean;
  onVersion: (n: number) => void;
  onMode: (m: 'proposed' | 'delta') => void;
  onBookmark: (n: number) => void;
  onDeleteVersion: (n: number) => void;
  onRefreshComps: () => void;
}

/** Bottom strip: version identity (pills + bookmark) is separated from the lens
 * (Proposed | Changes) so switching versions never reads as switching views. */
export default function ReviewStrip({
  review,
  currentN,
  head,
  mode,
  busy,
  onVersion,
  onMode,
  onBookmark,
  onDeleteVersion,
  onRefreshComps,
}: Props) {
  const current = review.versions.find((v) => v.n === currentN);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="ws-strip">
      <div className="strip-versions" role="group" aria-label="Versions">
        {review.versions.map((v) => (
          <button
            key={v.n}
            className={`strip-pill${v.n === currentN ? ' active' : ''}`}
            title={`$${v.rent.proposed_per_week.toFixed(0)}/wk · ${v.config}${v.saved ? ' · bookmarked' : ''}${v.n === head ? ' · latest' : ''}`}
            onClick={() => onVersion(v.n)}
          >
            v{pad(v.n)}
            {v.saved && v.n > 0 ? <span className="star">★</span> : ''}
          </button>
        ))}
      </div>

      <div className="strip-lens" role="group" aria-label="View">
        <button
          data-lens="proposed"
          className={mode === 'proposed' ? 'active' : ''}
          onClick={() => onMode('proposed')}
        >
          Proposed
        </button>
        <button
          data-lens="delta"
          className={mode === 'delta' ? 'active' : ''}
          onClick={() => onMode('delta')}
        >
          Changes v00 → v{pad(head)}
        </button>
      </div>

      <div className="strip-acts">
        {currentN !== head ? (
          <span className="readonly">
            read-only · v{pad(currentN)} of v{pad(head)}
            <button className="linklike" onClick={() => onVersion(head)}>
              jump to head
            </button>
            {head > 0 && (
              <button
                className="linklike danger"
                disabled={busy}
                title={`Delete v${pad(head)} — rolls back to editable v${pad(head - 1)}`}
                onClick={() => onDeleteVersion(head)}
              >
                delete v{pad(head)}
              </button>
            )}
          </span>
        ) : (
          head > 0 && (
            <button
              className="linklike danger"
              disabled={busy}
              title={`Delete v${pad(head)} — rolls back to editable v${pad(head - 1)}`}
              onClick={() => onDeleteVersion(head)}
            >
              delete v{pad(head)}
            </button>
          )
        )}
        {currentN > 0 && (
          <button
            className="linklike bookmark"
            title="Bookmarked versions survive auto-pruning (only the original and latest are kept otherwise)"
            onClick={() => onBookmark(currentN)}
          >
            {current?.saved ? '★ bookmarked' : '☆ bookmark'}
          </button>
        )}
        <a href={api.exportUrl(review.review_id, currentN)} target="_blank" rel="noreferrer">
          ↓ PNG
        </a>
        <a href={api.summaryUrl(review.review_id)} target="_blank" rel="noreferrer">
          ↓ SUMMARY.md
        </a>
        <button className="linklike" onClick={onRefreshComps}>
          refresh comps
        </button>
      </div>
    </div>
  );
}
