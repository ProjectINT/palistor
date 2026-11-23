import { queryEngineers, type Engineer } from "./backend";
import { readJson } from "./shared/db";
import { SsrProviders } from "./shared/SsrProviders";
import { INITIAL_FILTER } from "./ssrConfig";
import { SsrView } from "./SsrView";

// A Server Component: it reads the rows where the data lives (here a JSON
// file, in an app a database or an API called with the user's cookies) and
// hands them to the client view as props. The store is created there, once
// per component instance, with the rows as `initialData`.
//
// <SsrProviders> (the client wrapper with <PalistorProvider>) would sit in a
// layout in an app. Here every /ssr page renders it: the root layout is shared
// with the store implementation, which has no provider.
//
// Cube only: `page.cube.tsx` is a route only when next.config.ts registers
// the `cube.tsx` page extension. The other /ssr routes live in the
// subdirectories (form/, catalog/, flow/, runtime/).

export default async function SsrPage() {
  // The same filter the store starts with, so the rows are what its first request would return.
  const table = await readJson<Engineer[]>("engineers.json");
  const engineers = queryEngineers(table, INITIAL_FILTER.search);

  return (
    <SsrProviders>
      <SsrView engineers={engineers} />
    </SsrProviders>
  );
}
