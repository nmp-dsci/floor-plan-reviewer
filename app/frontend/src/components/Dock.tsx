export type DockTab = 'edit' | 'agent' | 'history' | 'rent';

export interface DockPanel {
  id: DockTab;
  label: string;
  badge?: number;
  node: React.ReactNode;
}

interface Props {
  tab: DockTab;
  onTab: (t: DockTab) => void;
  panels: DockPanel[];
}

/** Right-hand tabbed dock: one panel visible at a time so the canvas keeps the
 * width. Selecting an object auto-raises EDIT (owned by the parent); queued
 * comments badge AGENT. */
export default function Dock({ tab, onTab, panels }: Props) {
  const active = panels.find((p) => p.id === tab) ?? panels[0];
  return (
    <div className="dock">
      <div className="dock-tabs" role="tablist" aria-label="Review tools">
        {panels.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === tab}
            className={`dock-tab${p.id === tab ? ' on' : ''}`}
            data-tab={p.id}
            onClick={() => onTab(p.id)}
          >
            {p.label}
            {p.badge ? <span className="dock-badge mono">{p.badge}</span> : null}
          </button>
        ))}
      </div>
      <div className="dock-body" role="tabpanel">
        {active.node}
      </div>
    </div>
  );
}
