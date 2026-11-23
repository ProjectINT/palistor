// The "backend" of /ssr/flow. Two sides use it:
//
// - the Server Component (page.cube.tsx) reads profile.json, as it would query
//   a database, and passes it to the view as the profile step's initialData;
// - the browser calls the fake endpoints below from the steps' resolvers.
//   They answer from memory after a delay and count their calls under
//   "flow.<step>" (shared/events.ts). The profile endpoint answers from the
//   same file, so the server's data is what its first request would return.

import profile from "./profile.json";
import { fakeRequest } from "../shared/events";

/** The profile step's values: the invited member, as the server has them. */
export interface Profile {
  name: string;
  email: string;
}

/** The team step's values. */
export interface Team {
  mentor: string;
  channel: string;
}

/** The slot step's values (second flow). */
export interface Slot {
  reviewer: string;
  startsAt: string;
}

/** The options of the team step's mentor select. */
export const MENTORS = ["Grace Hopper", "Frances Allen", "Barbara Liskov"];

// ─── Fake endpoints (browser only) ───────────────────────────────────────────

export const fetchProfile = (): Promise<Profile> => fakeRequest("flow.profile", () => ({ ...profile }), 500);

export const fetchTeam = (workspace: string): Promise<Team> =>
  fakeRequest("flow.team", () => ({ mentor: "Frances Allen", channel: `#${workspace}` }), 700);

export const fetchSlot = (): Promise<Slot> =>
  fakeRequest("flow.slot", () => ({ reviewer: "Barbara Liskov", startsAt: "Thursday, 14:00" }), 800);
