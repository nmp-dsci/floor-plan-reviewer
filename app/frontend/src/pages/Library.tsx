import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { PlanListItem } from '../types';

export default function Library({ uploadFocus = false, notFound = false }: { uploadFocus?: boolean; notFound?: boolean }) {
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [address, setAddress] = useState('');
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.plans().then(setPlans).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (uploadFocus) uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [uploadFocus]);

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const { plan_id } = await api.uploadPlan(file, address);
      window.location.hash = `#/ingest/${plan_id}`;
    } catch (e) {
      setError(String(e));
      setUploading(false);
    }
  };

  return (
    <>
      <header className="site">
        <div className="kicker">floor-plan studio</div>
        <h1>Plan library</h1>
        <div className="sub">
          Pick a plan to review, or upload a listing floor-plan image and let the vision agent
          convert it to editable geometry.
        </div>
      </header>
      {notFound && <div className="banner error">That page doesn’t exist — showing the library.</div>}
      {error && <div className="banner error">{error}</div>}
      <div className="grid">
        <div className="card">
          <h2>Properties</h2>
          <div className="body">
            <table className="list">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Config</th>
                  <th>Head</th>
                  <th>Rent</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const uplift = p.rent ? p.rent.proposed_per_week - p.rent.baseline_per_week : null;
                  return (
                    <tr
                      key={p.plan_id}
                      className={p.review_id ? 'click' : ''}
                      onClick={() => {
                        if (p.review_id) window.location.hash = `#/review/${p.review_id}`;
                        else window.location.hash = `#/ingest/${p.plan_id}`;
                      }}
                    >
                      <td>
                        <b>{p.address || p.slug}</b>
                      </td>
                      <td>{p.config ?? '—'}</td>
                      <td>{p.head_n !== undefined ? `v${String(p.head_n).padStart(2, '0')}` : 'needs ingest'}</td>
                      <td>
                        {p.rent ? `$${p.rent.proposed_per_week.toFixed(0)}/wk` : '—'}
                        {uplift !== null && uplift !== 0 && (
                          <span className={`mono ${uplift > 0 ? 'up' : 'down'}`} style={{ marginLeft: 6, fontSize: 11 }}>
                            {uplift > 0 ? '+' : '−'}${Math.abs(uplift).toFixed(0)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {plans.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--faint)' }}>
                      No plans yet — the seed loads 231 Peats Ferry Rd on first backend start.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" ref={uploadRef}>
          <h2>Upload a floor plan</h2>
          <div className="body">
            <div className="field">
              <label>Listing floor-plan image (PNG/JPG)</label>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="field">
              <label>Address (optional)</label>
              <input value={address} placeholder="12 Example St, Hornsby" onChange={(e) => setAddress(e.target.value)} />
            </div>
            <button className="primary" onClick={upload} disabled={!file || uploading}>
              {uploading ? 'Uploading…' : 'Upload → vision ingest'}
            </button>
          </div>
        </div>
      </div>
      <footer>Floor-Plan Studio · geometry-first floor-plan review · local build</footer>
    </>
  );
}
