import type { Op } from './editing';
import type {
  Comp,
  PlanGeometry,
  PlanListItem,
  QueuedComment,
  RegisterHunk,
  Review,
  VersionDetail,
} from './types';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, init);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  plans: () => json<PlanListItem[]>('/api/plans'),
  review: (id: string) => json<Review>(`/api/reviews/${id}`),
  version: (id: string, n: number) => json<VersionDetail>(`/api/reviews/${id}/versions/${n}`),
  submitComments: (id: string, versionN: number, comments: QueuedComment[]) =>
    json<{ job_id: string }>(`/api/reviews/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_n: versionN,
        comments: comments.map((c) => ({ text: c.text, targets: c.targets })),
      }),
    }),
  applyEdits: (id: string, versionN: number, ops: Op[], title: string) =>
    json<{ n: number; warnings: string[] }>(`/api/reviews/${id}/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_n: versionN, ops, title }),
    }),
  registers: (id: string) =>
    json<{ n: number; register: RegisterHunk[] }[]>(`/api/reviews/${id}/registers`),
  deleteVersion: (id: string, n: number) =>
    json<{ deleted: number; head_n: number }>(`/api/reviews/${id}/versions/${n}`, {
      method: 'DELETE',
    }),
  refreshComps: (id: string) =>
    json<{ comps: Comp[] }>(`/api/reviews/${id}/comps/refresh`, { method: 'POST' }),
  planImageUrl: (planId: string) => `/api/plans/${planId}/image`,
  uploadPlan: async (file: File, address: string) => {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(`/api/plans?address=${encodeURIComponent(address)}`, {
      method: 'POST',
      body: form,
    });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json() as Promise<{ plan_id: string }>;
  },
  ingest: (planId: string) =>
    json<{ geometry: PlanGeometry; notes: string[]; errors: string[]; warnings: string[] }>(
      `/api/plans/${planId}/ingest`,
      { method: 'POST' },
    ),
  approve: (planId: string, geometry: PlanGeometry, baseline: number) =>
    json<{ review_id: string }>(`/api/plans/${planId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geometry, baseline_per_week: baseline }),
    }),
  exportUrl: (id: string, n: number) => `/api/reviews/${id}/versions/${n}/export.png`,
  summaryUrl: (id: string) => `/api/reviews/${id}/summary.md`,
};

export type StudioEvent =
  | { type: 'job.status'; job_id: string; status: string }
  | { type: 'version.ready'; n: number; job_id: string; warnings: string[] }
  | { type: 'version.deleted'; n: number; head_n: number }
  | { type: 'job.error'; job_id: string; error: string };

export function subscribe(reviewId: string, onEvent: (e: StudioEvent) => void): () => void {
  const source = new EventSource(`/api/reviews/${reviewId}/events`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as StudioEvent);
    } catch {
      // keepalive or malformed — ignore
    }
  };
  return () => source.close();
}
