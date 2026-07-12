import type { RegisterHunk } from '../types';

export default function Register({ hunks }: { hunks: { version: number; hunk: RegisterHunk }[] }) {
  if (hunks.length === 0) {
    return <div className="body" style={{ color: 'var(--faint)', fontSize: 13 }}>No changes yet — this is the original plan.</div>;
  }
  return (
    <div className="body">
      {hunks.map(({ version, hunk }) => {
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
    </div>
  );
}
