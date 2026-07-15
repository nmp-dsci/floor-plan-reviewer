import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { PlanListItem } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

export default function Library({
  uploadFocus = false,
  notFound = false,
}: {
  uploadFocus?: boolean;
  notFound?: boolean;
}) {
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [error, setError] = useState('');
  const uploadRef = useRef<HTMLDivElement>(null);

  const refresh = () => api.plans().then(setPlans).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (uploadFocus) uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [uploadFocus]);

  return (
    <>
      <header className="site">
        <div className="kicker">floor-plan studio</div>
        <h1>Plan library</h1>
        <div className="sub">
          Open a plan to review it, or drop in a listing floor plan and we’ll read its rooms and
          dimensions for you — then propose changes that lift the weekly rent.
        </div>
      </header>
      {notFound && <div className="banner error">That page doesn’t exist — showing the library.</div>}
      {error && <div className="banner error">{error}</div>}

      <div className={`lib-grid${plans.length === 0 ? ' empty' : ''}`}>
        {plans.map((p) => (
          <PlanCard key={p.plan_id} plan={p} onChanged={refresh} />
        ))}
        <div className="lib-drop-card" ref={uploadRef}>
          <UploadCard />
        </div>
      </div>
    </>
  );
}

function PlanCard({ plan, onChanged }: { plan: PlanListItem; onChanged: () => void }) {
  const reviewed = Boolean(plan.review_id);
  const uplift =
    plan.rent && reviewed ? plan.rent.proposed_per_week - plan.rent.baseline_per_week : null;
  const thumb =
    reviewed && plan.head_n !== undefined
      ? api.exportUrl(plan.review_id!, plan.head_n)
      : api.planImageUrl(plan.plan_id);
  const open = () => {
    window.location.hash = reviewed ? `#/review/${plan.review_id}` : `#/ingest/${plan.plan_id}`;
  };

  return (
    <div className="lib-card">
      <button className="lib-thumb" onClick={open} aria-label={`Open ${plan.address || plan.slug}`}>
        <Thumb src={thumb} />
      </button>
      <div className="lib-cardbody">
        <div className="lib-addr">{plan.address || plan.slug}</div>
        <div className="lib-cfg mono">
          {plan.config ?? 'not read yet'}
          {plan.head_n !== undefined ? ` · v${pad(plan.head_n)}` : ''}
        </div>
        {reviewed && plan.rent ? (
          <div className="lib-rent">
            <span className="mono strong">${plan.rent.proposed_per_week.toFixed(0)}/wk</span>
            {uplift !== null && uplift !== 0 && (
              <span className={`mono ${uplift > 0 ? 'up' : 'down'}`}>
                {uplift > 0 ? '+' : '−'}${Math.abs(uplift).toFixed(0)}/wk
              </span>
            )}
          </div>
        ) : (
          <div className="lib-status">
            <span className="chip amber">Finish setup — read the rooms</span>
          </div>
        )}
        <div className="lib-actions">
          <button className="primary" onClick={open}>
            {reviewed ? 'Open review' : 'Continue'}
          </button>
          {!reviewed && <DeleteControl planId={plan.plan_id} onDeleted={onChanged} />}
        </div>
      </div>
    </div>
  );
}

function Thumb({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="lib-thumb-empty">no preview</span>;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function DeleteControl({ planId, onDeleted }: { planId: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return (
      <button className="ghost danger" onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }
  return (
    <span className="lib-confirm">
      Delete draft?
      <button
        className="ghost danger"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          api
            .deletePlan(planId)
            .then(onDeleted)
            .catch(() => setBusy(false));
        }}
      >
        {busy ? '…' : 'yes'}
      </button>
      <button className="ghost" onClick={() => setConfirming(false)}>
        no
      </button>
    </span>
  );
}

function UploadCard() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [address, setAddress] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (f: File | null | undefined) => {
    setError('');
    if (f && /^image\//.test(f.type)) setFile(f);
    else if (f) setError('Please choose a PNG or JPG image.');
  };

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

  if (file) {
    return (
      <div className="lib-drop has-file">
        <img className="lib-preview" src={preview} alt="Selected floor plan" />
        <input
          className="lib-addr-input"
          placeholder="Address (optional)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        {error && <div className="lib-drop-err">{error}</div>}
        {uploading ? (
          <div className="lib-progress mono">Uploading &amp; reading your plan…</div>
        ) : (
          <div className="lib-drop-actions">
            <button className="primary" onClick={upload}>
              Upload &amp; read plan
            </button>
            <button className="ghost" onClick={() => setFile(null)}>
              Choose another
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <label
      className={`lib-drop${dragOver ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        pick(e.dataTransfer.files?.[0]);
      }}
    >
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <div className="lib-drop-icon" aria-hidden="true">
        ⤓
      </div>
      <div className="lib-drop-title">Drop a floor plan</div>
      <div className="lib-drop-sub">
        PNG or JPG · or click to browse
        <br />
        We’ll read the rooms and dimensions for you
      </div>
      {error && <div className="lib-drop-err">{error}</div>}
    </label>
  );
}
