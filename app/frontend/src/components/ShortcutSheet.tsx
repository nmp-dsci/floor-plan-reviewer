import { SHORTCUTS } from '../features';

/** The `?` shortcut sheet — rendered from the SHORTCUTS registry so it can't drift
 * from the real handlers (F11). */
export default function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard and mouse shortcuts"
      onClick={onClose}
    >
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span>Keyboard &amp; mouse</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <table className="sheet-table">
          <tbody>
            {SHORTCUTS.map((s, i) => (
              <tr key={i}>
                <td className="mono keys">{s.keys}</td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
