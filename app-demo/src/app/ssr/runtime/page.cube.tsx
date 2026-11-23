import type { Teammate } from "./backend";
import { readJson } from "../shared/db";
import { SsrProviders } from "../shared/SsrProviders";
import { RuntimeView } from "./RuntimeView";

// A Server Component, like the overview's page: it reads the teammates where
// the data lives (a JSON file here) and passes them as props. The client view
// renders one card per teammate, and each card builds its own store with its
// teammate as `initialData` — the rows the card's resolver would return.
//
// Static export: no cookies(), headers() or searchParams, so the page is
// rendered once at build time (per request in dev).

export default async function RuntimePage() {
  const teammates = await readJson<Teammate[]>("runtime", "teammates.json");

  return (
    <SsrProviders>
      <RuntimeView teammates={teammates} />
    </SsrProviders>
  );
}
