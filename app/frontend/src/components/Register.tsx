import { useState } from 'react';
import type { RegisterHunk } from '../types';

interface Props {
  hunks: { version: number; hunk: RegisterHunk }[];
  open: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** One change as a plain sentence carrying its rent contribution; the exact op
 * diff is one disclosure away — same data, two altitudes (auditability kept). */
function HunkRow({ version, hunk }: { version: number; hunk: RegisterHunk }) {
  const [showOps, setShowOps] = useState(false);
  const author = hunk.author ?? 'agent';
  const opCount = hunk.lines.length;
  const zero = /\$0\/wk/.test(hunk.impact);
  const neg = hunk.impact.trim().startsWith('-');

  return (
    <div className="reg-row">
      <div className="reg-top">
        <strong className="reg-title">{hunk.title}</strong>
        <span className={`chip author ${author}`}>
          {author} · v{pad(version)}
        </span>
      </div>
      {hunk.rationale && <div className="reg-why">{hunk.rationale}</div>}
      <div className="reg-meta">
        rent impact{' '}
        <span className={`mono ${zero ? 'faint' : neg ? 'down' : 'up'}`}>{hunk.impact}</span>
        {zero && <span className="faint"> — pending re-price</span>}
      </div>
      {hunk.flags.length > 0 && <div className="reg-flags">⚑ {hunk.flags.join(' · ')}</div>}
      {opCount > 0 ? (
        <>
          <button className="reg-disclose" aria-expanded={showOps} onClick={() => setShowOps((o) => !o)}>
            {showOps ? '▾ hide exact ops' : `▸ show exact ops (${opCount})`}
          </button>
          {showOps && (
            <pre className="diff">
              <span className="h">{`@@ ${hunk.id} · v${pad(version)} @@`}</span>
              {hunk.lines.map((line, i) => (
                <span key={i} className={line.op === 'add' ? 'add' : 'del'}>
                  {(line.op === 'add' ? '+ ' : '- ') + line.text}
                </span>
              ))}
            </pre>
          )}
        </>
      ) : (
        <div className="reg-meta faint">metadata-only change</div>
      )}
    </div>
  );
}

export default function Register({ hunks, open }: Props) {
  if (hunks.length === 0) {
    return (
      <div className="body" style={{ color: 'var(--faint)', fontSize: 13 }}>
        No changes yet — this is the original plan.
      </div>
    );
  }
  // hunks are latest-first; collapsed shows just the most recent one.
  const shown = open ? hunks : hunks.slice(0, 1);
  const hidden = hunks.length - shown.length;
  return (
    <div className="body reg-list">
      {shown.map(({ version, hunk }) => (
        <HunkRow key={`${version}-${hunk.id}`} version={version} hunk={hunk} />
      ))}
      {!open && hidden > 0 && (
        <div className="register-more">
          {hidden} older change{hidden === 1 ? '' : 's'} hidden — expand to view
        </div>
      )}
    </div>
  );
}
