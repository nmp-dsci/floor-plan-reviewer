import type { PlanListItem } from '../types';

interface Props {
  plans: PlanListItem[];
  route: { page: string; id: string };
  backendOk: boolean;
  busy: boolean;
  open: boolean;
  onNavigate: () => void;
}

export default function Sidebar({ plans, route, backendOk, busy, open, onNavigate }: Props) {
  const go = (hash: string) => {
    window.location.hash = hash;
    onNavigate();
  };
  return (
    <nav className={`sidebar${open ? ' open' : ''}`}>
      <a
        className="brand"
        href="#/"
        onClick={(e) => {
          e.preventDefault();
          go('#/');
        }}
      >
        <span className="b1">
          Floor-Plan
          <br />
          Studio
        </span>
        <span className="b2">geometry-first review</span>
      </a>
      <div className="group">Workspace</div>
      <button className={`item${route.page === 'library' ? ' active' : ''}`} onClick={() => go('#/')}>
        <span>Library</span>
      </button>
      <button className={`item${route.page === 'upload' ? ' active' : ''}`} onClick={() => go('#/upload')}>
        <span>Upload plan</span>
      </button>
      <div className="group">Recent reviews</div>
      {plans.length === 0 && <div className="empty">No plans yet.</div>}
      {plans.map((p) => {
        const active =
          (route.page === 'review' && route.id === p.review_id) ||
          (route.page === 'ingest' && route.id === p.plan_id);
        const uplift = p.rent ? p.rent.proposed_per_week - p.rent.baseline_per_week : null;
        return (
          <button
            key={p.plan_id}
            className={`addr${active ? ' active' : ''}`}
            onClick={() => go(p.review_id ? `#/review/${p.review_id}` : `#/ingest/${p.plan_id}`)}
          >
            <span className="a1">{p.address || p.slug}</span>
            <span className="a2">
              {p.config && <span>{p.config.replaceAll(' · ', '·').replaceAll(' ', '')}</span>}
              <span>{p.head_n !== undefined ? `v${String(p.head_n).padStart(2, '0')}` : 'needs ingest'}</span>
              {uplift !== null && (
                <span className={uplift >= 0 ? 'up' : 'down'}>
                  {uplift >= 0 ? '+' : '−'}${Math.abs(uplift).toFixed(0)}/wk
                </span>
              )}
            </span>
          </button>
        );
      })}
      <div className="foot">
        <span className={`dot${busy ? ' busy' : backendOk ? '' : ' err'}`} />
        {busy ? 'agent working…' : backendOk ? 'agent idle · backend ok' : 'backend unreachable'}
      </div>
    </nav>
  );
}
