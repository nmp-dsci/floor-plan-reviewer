import type { RegisterHunk } from '../types';

interface Props {
  hunks: { version: number; hunk: RegisterHunk }[];
  open: boolean;
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
    <div className="body">
      {shown.map(({ version, hunk }) => {
        const author = hunk.author ?? 'agent';
        return (
          <div key={`${version}-${hunk.id}`}>
            <pre className="diff">
              <span className="h">
                {`@@ ${hunk.id} · v${String(version).padStart(2, '0')} · ${hunk.title}  ${hunk.impact} @@`}
                <span className={`authtag ${author}`}>{author}</span>
              </span>
              {hunk.lines.map((line, i) => (
                <span key={i} className={line.op === 'add' ? 'add' : 'del'}>
                  {(line.op === 'add' ? '+ ' : '- ') + line.text}
                </span>
              ))}
              {hunk.lines.length === 0 && <span className="h">  (metadata-only change)</span>}
            </pre>
            {hunk.flags.length > 0 && <div className="hunk-flags">⚑ {hunk.flags.join(' · ')}</div>}
          </div>
        );
      })}
      {!open && hidden > 0 && (
        <div className="register-more">
          {hidden} older change{hidden === 1 ? '' : 's'} hidden — expand to view
        </div>
      )}
    </div>
  );
}
