import { useEffect, useState } from 'react';
import Ingest from './pages/Ingest';
import Library from './pages/Library';
import Review from './pages/Review';

function route(hash: string) {
  const review = hash.match(/^#\/review\/([a-z0-9-]+)/i);
  if (review) return { page: 'review' as const, id: review[1] };
  const ingest = hash.match(/^#\/ingest\/([a-z0-9-]+)/i);
  if (ingest) return { page: 'ingest' as const, id: ingest[1] };
  return { page: 'library' as const, id: '' };
}

export default function App() {
  const [current, setCurrent] = useState(route(window.location.hash));
  useEffect(() => {
    const onHash = () => setCurrent(route(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="wrap">
      {current.page === 'review' && <Review key={current.id} reviewId={current.id} />}
      {current.page === 'ingest' && <Ingest key={current.id} planId={current.id} />}
      {current.page === 'library' && <Library />}
    </div>
  );
}
