// The "backend" of /ssr/runtime. Two sides use it:
//
// - the Server Component (page.cube.tsx) reads teammates.json, as it would
//   query a database;
// - the browser calls the fake endpoints below from the stores' resolvers.
//   They answer from memory after a delay and count their calls under
//   "runtime.<endpoint>" names (shared/events.ts); nothing touches the network.

import table from "./teammates.json";
import { fakeRequest } from "../shared/events";

export interface Build {
  id: string;
  target: string;
  status: string;
}

export interface Release {
  id: string;
  date: string;
}

export interface Teammate {
  id: string;
  name: string;
  role: string;
}

export interface Mirror {
  host: string;
  latency: number;
}

export const REGIONS = ["eu-west", "us-east", "ap-south"] as const;
export type Region = (typeof REGIONS)[number];

const BUILDS: Build[] = [
  { id: "b-412", target: "x86_64-linux", status: "passed" },
  { id: "b-411", target: "aarch64-darwin", status: "passed" },
  { id: "b-410", target: "wasm32", status: "failed" },
];

const RELEASES: Release[] = [
  { id: "v2.4.0", date: "2026-11-20" },
  { id: "v2.3.1", date: "2026-10-02" },
];

const LATENCY: Record<Region, number> = { "eu-west": 18, "us-east": 92, "ap-south": 164 };

// ─── Fake endpoints (browser only) ───────────────────────────────────────────
// Counted synchronously, inside the resolver call. That is safe because a
// usePalistor store calls its resolvers only after its component has committed
// (store.start() in the hook's effect): a counter never moves under a render in
// progress, which would make React throw that render away and start over.

/** Blocks 1 and 2 count the same endpoint under their own names ("runtime.held.builds", "runtime.client.builds"). */
export const fetchBuilds = (counter: string, delay: number): Promise<Build[]> =>
  fakeRequest(counter, () => BUILDS, delay);

export const fetchReleases = (counter: string, delay: number): Promise<Release[]> =>
  fakeRequest(counter, () => RELEASES, delay);

/** The same row the server page reads from teammates.json. */
export const fetchTeammate = (id: string): Promise<Pick<Teammate, "name" | "role">> =>
  fakeRequest(
    `runtime.teammate.${id}`,
    () => {
      const row = table.find((teammate) => teammate.id === id);
      if (!row) throw new Error(`No teammate ${id}`);
      return { name: row.name, role: row.role };
    },
    400,
  );

export const fetchMirror = (workspace: string, region: Region): Promise<Mirror> =>
  fakeRequest("runtime.mirror", () => ({ host: `${region}.mirror.${workspace}.dev`, latency: LATENCY[region] }), 600);
