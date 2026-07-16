import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import Sidebar from './components/Sidebar';
import Admin from './pages/Admin';
import Ingest from './pages/Ingest';
import Library from './pages/Library';
import Review from './pages/Review';
import type { PlanListItem } from './types';

export type Route =
  | { page: 'library'; id: '' }
  | { page: 'upload'; id: '' }
  | { page: 'admin'; id: '' }
  | { page: 'review'; id: string }
  | { page: 'ingest'; id: string }
  | { page: 'lost'; id: '' };

function route(hash: string): Route {
  const review = hash.match(/^#\/review\/([a-z0-9-]+)/i);
  if (review) return { page: 'review', id: review[1] };
  const ingest = hash.match(/^#\/ingest\/([a-z0-9-]+)/i);
  if (ingest) return { page: 'ingest', id: ingest[1] };
  if (/^#\/upload/.test(hash)) return { page: 'upload', id: '' };
  if (/^#\/admin/.test(hash)) return { page: 'admin', id: '' };
  if (!hash || hash === '#' || hash === '#/') return { page: 'library', id: '' };
  return { page: 'lost', id: '' };
}

export default function App() {
  const [current, setCurrent] = useState<Route>(route(window.location.hash));
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [backendOk, setBackendOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const refreshPlans = useCallback(() => {
    api
      .plans()
      .then((p) => {
        setPlans(p);
        setBackendOk(true);
      })
      .catch(() => setBackendOk(false));
  }, []);

  useEffect(() => {
    const onHash = () => setCurrent(route(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    refreshPlans();
  }, [refreshPlans, current.page, current.id]);

  return (
    <div className="shell">
      <button className="navtoggle" aria-label="menu" onClick={() => setNavOpen((o) => !o)}>
        ☰
      </button>
      <Sidebar
        plans={plans}
        route={current}
        backendOk={backendOk}
        busy={busy}
        open={navOpen}
        onNavigate={() => setNavOpen(false)}
      />
      <main className={`content${current.page === 'review' ? ' content-review' : ''}`}>
        {current.page === 'review' && (
          <Review key={current.id} reviewId={current.id} onBusyChange={setBusy} onVersionAdded={refreshPlans} />
        )}
        {current.page === 'ingest' && <Ingest key={current.id} planId={current.id} />}
        {current.page === 'admin' && <Admin />}
        {(current.page === 'library' || current.page === 'upload' || current.page === 'lost') && (
          <Library uploadFocus={current.page === 'upload'} notFound={current.page === 'lost'} />
        )}
      </main>
    </div>
  );
}
