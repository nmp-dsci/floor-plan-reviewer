import { useEffect, useRef, useState } from 'react';

interface Props {
  /** vp.width / vp.height of the plan being rendered — the SVG's intrinsic aspect. */
  aspect: number;
  onUndo?: () => void;
  canUndo?: boolean;
  children: React.ReactNode;
}

const CLAMP = { min: 0.25, max: 4 } as const;

/**
 * Zoom/fit viewport wrapper around PlanCanvas. The canvas SVG scales via its own
 * `width: 100%` + viewBox, so we scale it by setting the inner wrapper's pixel width —
 * a NATIVE viewBox scaling that keeps `getScreenCTM()` (and every gesture) exact. The
 * canvas internals are never touched. `zoom === null` means "fit", which re-fits on
 * resize; any explicit +/− pins an absolute zoom.
 */
export default function CanvasStage({ aspect, onUndo, canUndo, children }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const measured = box.w > 0 && box.h > 0;
  // fit: largest width where the whole plan still fits the box in both axes
  const fitZoom = measured ? Math.min(1, (box.h * a) / box.w) : 1;
  const z = zoom ?? fitZoom;
  const widthPx = Math.max(1, box.w * z);
  const pct = fitZoom > 0 ? Math.round((z / fitZoom) * 100) : 100;

  const setClamped = (next: number) => setZoom(Math.min(CLAMP.max, Math.max(CLAMP.min, next)));

  return (
    <div className="stage" ref={scrollRef}>
      <div className="stage-tools" role="toolbar" aria-label="Canvas zoom">
        <button aria-label="Zoom out" onClick={() => setClamped(z * 0.8)}>
          −
        </button>
        <span className="mono pct" title="Zoom (100% = fit to view)">
          {pct}%
        </span>
        <button aria-label="Zoom in" onClick={() => setClamped(z * 1.25)}>
          +
        </button>
        <button className="lbl" onClick={() => setZoom(null)} aria-label="Fit to view">
          Fit
        </button>
        <button
          className="lbl undo"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo the last edit (⌘Z)"
        >
          ⌘Z Undo
        </button>
      </div>
      <div className="stage-inner" style={{ width: measured ? widthPx : '100%' }}>
        {children}
      </div>
    </div>
  );
}
