import { useState } from 'react';

const KEY = 'fps-coach-dismissed';

/** First-run coach for the review page — explains the two editing lanes once per
 * browser (F10). Dismissed state is stored locally; returning users never see it. */
export default function Coach() {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== '1';
    } catch {
      return true;
    }
  });
  if (!show) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode — just hide for this session */
    }
    setShow(false);
  };
  return (
    <div className="coach-backdrop" role="dialog" aria-modal="true" aria-label="How to change the plan">
      <div className="coach-card">
        <div className="coach-head">
          <span>Two ways to change this plan</span>
          <button className="modal-x" onClick={close} aria-label="Dismiss">
            ✕
          </button>
        </div>
        <div className="coach-body">
          <div className="coach-lane">
            <div className="coach-lane-h">Edit tab · instant</div>
            <p>
              <b>Select</b> a room, wall or fixture on the plan, then change it directly in the Edit
              tab. Edits apply with no agent — one version per <b>Apply</b>.
            </p>
          </div>
          <div className="coach-lane">
            <div className="coach-lane-h">Agent tab · describe it</div>
            <p>
              Or <b>describe</b> the change in words, <b>add</b> it to the list and <b>send</b> — the
              agent returns validated geometry and a re-priced rent.
            </p>
          </div>
        </div>
        <div className="coach-foot">
          <button className="primary" onClick={close}>
            Got it
          </button>
          <span className="coach-hint">
            Press <span className="mono">?</span> anytime for keyboard shortcuts.
          </span>
        </div>
      </div>
    </div>
  );
}
