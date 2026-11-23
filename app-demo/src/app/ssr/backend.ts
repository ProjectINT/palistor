// The demo's "backend". Two sides use it:
//
// - the Server Component (page.cube.tsx) runs `queryEngineers` against
//   engineers.json, as it would query a database;
// - the browser calls the fake endpoints below from the store's resolvers.
//   They answer from memory after a delay and count their calls
//   (shared/events.ts) — nothing here touches the network.

import table from "./engineers.json";
import { fakeRequest } from "./shared/events";

export interface Engineer {
  id: string;
  name: string;
  focus: string;
}

export interface Project {
  id: string;
  title: string;
  year: number;
}

export interface Summary {
  workspace: string;
  headcount: number;
  topFocus: string;
}

/** The one query of the page: the server and the fake endpoint must agree on it. */
export function queryEngineers(rows: Engineer[], search: string): Engineer[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(q) || row.focus.toLowerCase().includes(q));
}

const PROJECTS: Project[] = [
  { id: "prj-1", title: "Apollo Guidance Computer", year: 1966 },
  { id: "prj-2", title: "FLOW-MATIC", year: 1955 },
  { id: "prj-3", title: "Spanning Tree Protocol", year: 1985 },
];

function summarize(rows: Engineer[], workspace: string): Summary {
  const byFocus = new Map<string, number>();
  for (const row of rows) byFocus.set(row.focus, (byFocus.get(row.focus) ?? 0) + 1);
  const [topFocus = ""] = [...byFocus.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return { workspace, headcount: rows.length, topFocus };
}

// ─── Fake endpoints (browser only) ───────────────────────────────────────────
// Counted under the names "engineers", "projects" and "summary" (shared/events.ts).

export const fetchEngineers = (params: { search: string }): Promise<Engineer[]> =>
  fakeRequest("engineers", () => queryEngineers(table, params.search), 400);

export const fetchProjects = (): Promise<Project[]> => fakeRequest("projects", () => PROJECTS, 600);

export const fetchSummary = (workspace: string): Promise<Summary> =>
  fakeRequest("summary", () => summarize(table, workspace), 800);
