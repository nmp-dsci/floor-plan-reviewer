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

export type OpeningType = 'door' | 'window' | 'open';

export interface Opening {
  id: string;
  type: OpeningType;
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
  id: string;
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

export type Author = 'agent' | 'human';

export interface Change {
  id: string;
  title: string;
  rationale: string;
  rent_impact_per_week: number;
  flags: string[];
  author?: Author;
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
  author?: Author;
  lines: RegisterLine[];
}

export interface VersionSummary {
  n: number;
  rent: Rent;
  changes: Change[];
  config: string;
  internal_area?: number;
  total_area?: number;
  saved?: boolean;
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

export interface OpeningSelection {
  id: string;
  wallId: string;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Selection {
  rooms: string[];
  walls: WallSelection[];
  fixtures: string[];
  openings: OpeningSelection[];
  region?: Region | null;
}

export const emptySelection = (): Selection => ({
  rooms: [],
  walls: [],
  fixtures: [],
  openings: [],
  region: null,
});

export const hasSelection = (s: Selection): boolean =>
  s.rooms.length > 0 ||
  s.walls.length > 0 ||
  s.fixtures.length > 0 ||
  s.openings.length > 0 ||
  Boolean(s.region);

export type Tool = 'select' | 'add-opening' | 'add-fixture' | 'add-room' | 'add-wall';

export interface QueuedComment {
  id: string;
  text: string;
  targets: {
    type: 'room' | 'wall' | 'fixture' | 'region';
    id: string;
    t0?: number;
    t1?: number;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  }[];
}
