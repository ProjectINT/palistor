// The "backend" of /ssr/form. Two sides use it:
//
// - the Server Component (page.cube.tsx) reads users.json and announcement.json
//   through shared/db.ts and shapes them with the queries below, as it would
//   query a database;
// - the browser calls the fake endpoints from the stores' resolvers. They
//   answer from the same JSON after a delay and count their calls
//   (shared/events.ts) — nothing here touches the network.
//
// The queries are shared, so the server's `initialData` is exactly what the
// first request of the store would return.

import announcement from "./announcement.json";
import users from "./users.json";
import { fakeRequest } from "../shared/events";

export type Role = "researcher" | "lead" | "engineer";

export const ROLES: readonly Role[] = ["researcher", "lead", "engineer"];

export interface Activity {
  id: string;
  title: string;
  date: string;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  bio: string;
  activity: Activity[];
}

/** What the profile group holds: its resolver's result. */
export interface Profile {
  name: string;
  email: string;
  role: string;
  bio: string;
}

/** An option of the user selector. */
export interface UserOption {
  id: string;
  name: string;
}

export interface Announcement {
  title: string;
  body: string;
}

// ─── Queries (server and browser) ────────────────────────────────────────────

export function findUser(table: UserRecord[], id: string): UserRecord {
  const user = table.find((row) => row.id === id);
  if (!user) throw new Error(`404: no user "${id}"`);
  return user;
}

export function profileOf(user: UserRecord): Profile {
  return { name: user.name, email: user.email, role: user.role, bio: user.bio };
}

export function activityOf(user: UserRecord): Activity[] {
  return user.activity;
}

export function optionsOf(table: UserRecord[]): UserOption[] {
  return table.map(({ id, name }) => ({ id, name }));
}

// ─── "Fail the next request" switches (browser only) ─────────────────────────

/** The endpoints a switch can break, by their counter names. */
export type FailingEndpoint = "form.profile" | "form.activity";

const failNext = new Set<FailingEndpoint>();
const failListeners = new Set<() => void>();

const emitFailures = () => failListeners.forEach((listener) => listener());

/** Arm (or disarm) one failure of the next call of `endpoint`. */
export function setFailNext(endpoint: FailingEndpoint, on: boolean): void {
  if (on) failNext.add(endpoint);
  else failNext.delete(endpoint);
  emitFailures();
}

export function isFailNextArmed(endpoint: FailingEndpoint): boolean {
  return failNext.has(endpoint);
}

export function subscribeFailures(listener: () => void): () => void {
  failListeners.add(listener);
  return () => {
    failListeners.delete(listener);
  };
}

/** True once per armed switch: the call that takes it fails. */
function takeFailure(endpoint: FailingEndpoint): boolean {
  if (!failNext.delete(endpoint)) return false;
  emitFailures();
  return true;
}

/** What a failed fake request rejects with. */
export const SIMULATED_FAILURE = "503 Service Unavailable (simulated)";

// ─── Fake endpoints (browser only) ───────────────────────────────────────────
// Counted under "form.profile", "form.activity" and "form.announcement".

export function fetchProfile(userId: string): Promise<Profile> {
  const fail = takeFailure("form.profile");
  return fakeRequest(
    "form.profile",
    () => {
      if (fail) throw new Error(SIMULATED_FAILURE);
      return profileOf(findUser(users, userId));
    },
    500,
  );
}

export function fetchActivity(userId: string): Promise<Activity[]> {
  const fail = takeFailure("form.activity");
  return fakeRequest(
    "form.activity",
    () => {
      if (fail) throw new Error(SIMULATED_FAILURE);
      return activityOf(findUser(users, userId));
    },
    600,
  );
}

export const fetchAnnouncement = (): Promise<Announcement> =>
  fakeRequest("form.announcement", () => announcement, 500);
