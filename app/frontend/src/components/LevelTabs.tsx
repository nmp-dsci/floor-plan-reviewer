import type { PlanGeometry, PlanLevel } from '../types';
import { planLevels } from '../geometry';

interface Props {
  geometry: PlanGeometry;
  active: string;
  onChange: (levelId: string) => void;
}

/** Tab strip for multi-level / multi-structure plans (storeys + detached garage etc.).
 * Renders nothing for a single-level plan, so ordinary plans look exactly as before. */
export default function LevelTabs({ geometry, active, onChange }: Props) {
  const levels: PlanLevel[] = planLevels(geometry);
  if (levels.length <= 1) return null;
  const count = (id: string) => geometry.rooms.filter((r) => (r.level ?? 'level-1') === id && r.z === 0).length;
  return (
    <div className="level-tabs" role="tablist" aria-label="Plan levels">
      {levels.map((lvl) => (
        <button
          key={lvl.id}
          role="tab"
          aria-selected={lvl.id === active}
          className={lvl.id === active ? 'active' : ''}
          onClick={() => onChange(lvl.id)}
        >
          {lvl.name}
          <span className="mono n">{count(lvl.id)}</span>
        </button>
      ))}
    </div>
  );
}
