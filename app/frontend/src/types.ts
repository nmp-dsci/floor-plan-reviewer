export interface Room {
  id: string;
  name: string;
  kind: string;
  dims: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: 'white' | 'grey';
  z: number;
}

export interface Opening {
  id: string;
  type: 'door' | 'window' | 'open';
  t0: number;
  t1: number;
}

export interface Wall {
  id: string;
  a: string;
  b: string;
  line: [number, number, number, number];
  t: number;
  openings: Opening[];
}

export interface Fixture {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface PlanGeometry {
  schema_version: number;
  property: string;
  address: string;
  rooms: Room[];
  walls: Wall[];
  fixtures: Fixture[];
  meta: Record<string, unknown>;
}

export interface Rent {
  currency: string;
  baseline_per_week: number;
  proposed_per_week: number;
}

export interface Change {
  id: string;
  title: string;
  rationale: string;
  rent_impact_per_week: number;
  flags: string[];
}

export interface RegisterLine {
  op: 'add' | 'remove';
  text: string;
}

export interface RegisterHunk {
  id: string;
  title: string;
  impact: string;
  rationale: string;
  flags: string[];
  lines: RegisterLine[];
}

export interface VersionSummary {
  n: number;
  rent: Rent;
  changes: Change[];
  config: string;
  created_at: string;
}

export interface Review {
  review_id: string;
  plan: { slug: string; address: string };
  baseline_per_week: number;
  comps: Comp[];
  head_n: number | null;
  versions: VersionSummary[];
}

export interface VersionDetail {
  n: number;
  geometry: PlanGeometry;
  rent: Rent;
  changes: Change[];
  register: RegisterHunk[];
  config: string;
}

export interface Comp {
  address: string;
  config: string;
  rent_per_week: number;
  source: string;
}

export interface PlanListItem {
  plan_id: string;
  slug: string;
  address: string;
  review_id: string | null;
  head_n?: number;
  rent?: Rent;
  config?: string;
}

export interface WallSelection {
  id: string;
  t0: number;
  t1: number;
  whole: boolean;
}

export interface Selection {
  rooms: string[];
  walls: WallSelection[];
}

export const emptySelection = (): Selection => ({ rooms: [], walls: [] });

export interface QueuedComment {
  id: string;
  text: string;
  targets: {
    type: 'room' | 'wall';
    id: string;
    t0?: number;
    t1?: number;
  }[];
}
