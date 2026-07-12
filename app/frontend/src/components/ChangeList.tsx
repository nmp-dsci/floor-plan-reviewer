import { useState } from 'react';
import type { QueuedComment, Selection } from '../types';

interface Props {
  selection: Selection;
  queue: QueuedComment[];
  busy: boolean;
  atHead: boolean;
  onQueue: (c: QueuedComment) => void;
  onRemove: (id: string) => void;
  onSend: () => void;
  onClearSelection: () => void;
}

export default function ChangeList({
  selection,
  queue,
  busy,
  atHead,
  onQueue,
  onRemove,
  onSend,
  onClearSelection,
}: Props) {
  const [text, setText] = useState('');
  const hasSelection = selection.rooms.length > 0 || selection.walls.length > 0;

  const add = () => {
    if (!text.trim()) return;
    onQueue({
      id: Math.random().toString(36).slice(2, 9),
      text: text.trim(),
      targets: [
        ...selection.rooms.map((id) => ({ type: 'room' as const, id })),
        ...selection.walls.map((w) => ({
          type: 'wall' as const,
          id: w.id,
          ...(w.whole ? {} : { t0: w.t0, t1: w.t1 }),
        })),
      ],
    });
    setText('');
    onClearSelection();
  };

  return (
    <>
      {hasSelection && (
        <div className="comment-panel">
          <div className="chips">
            {selection.rooms.map((id) => (
              <span key={id} className="chip">{id}</span>
            ))}
            {selection.walls.map((w) => (
              <span key={w.id} className="chip">
                {w.id.replace('w:', '')}
                {w.whole ? '' : ` · ${w.t0.toFixed(2)}–${w.t1.toFixed(2)}`}
              </span>
            ))}
          </div>
          <textarea
            value={text}
            placeholder='e.g. "open this wall — servery window" or "make this a study"'
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add();
            }}
          />
          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
            <button className="primary" onClick={add} disabled={!text.trim()}>
              Add to change list
            </button>
            <button className="ghost" onClick={onClearSelection}>Clear selection</button>
          </div>
        </div>
      )}
      <div className="body">
        {queue.length === 0 && (
          <div style={{ color: 'var(--faint)', fontSize: 13, marginBottom: 8 }}>
            Nothing queued. Click a room or wall on the plan (long-press or shift-click for
            multi-select), write a comment, add it here.
          </div>
        )}
        {queue.length > 0 && (
          <ul className="queue">
            {queue.map((c) => (
              <li key={c.id}>
                <span className="t">“{c.text}”</span>
                <span className="meta">
                  <span className="chips">
                    {c.targets.map((t, i) => (
                      <span key={i} className="chip">
                        {t.id.replace('w:', '')}
                        {t.t0 !== undefined ? ` · ${t.t0.toFixed(2)}–${(t.t1 ?? 1).toFixed(2)}` : ''}
                      </span>
                    ))}
                  </span>
                  <button className="ghost" onClick={() => onRemove(c.id)}>remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <button className="primary" onClick={onSend} disabled={queue.length === 0 || busy || !atHead}>
          {busy ? 'Agent working…' : `Send ${queue.length || ''} change${queue.length === 1 ? '' : 's'} to agent`}
        </button>
        {!atHead && (
          <div style={{ color: 'var(--faint)', fontSize: 12, marginTop: 6 }}>
            Viewing an old version — jump to the head version to submit changes.
          </div>
        )}
      </div>
    </>
  );
}
