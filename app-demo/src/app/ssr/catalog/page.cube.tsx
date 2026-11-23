import { readJson } from "../shared/db";
import { SsrProviders } from "../shared/SsrProviders";
import { queryMilestones, queryPapers, type Milestone, type Paper, type Team } from "./backend";
import { CatalogView } from "./CatalogView";
import { MILESTONES_PAGE_SIZE, PAPERS_PAGE_SIZE } from "./catalogConfig";

// /ssr/catalog — a Server Component, like the overview (../page.cube.tsx): it
// reads the rows where the data lives and hands them to the client view.
//
// The paginated lists get their first page, the way their resolver would
// return it: what the store's first request would get (initialPage, the
// declared page size, no cursor yet). The talks are not read here: that list
// shows what happens without server data. The teams come with their members,
// the rows of the list nested in each team's row.

export default async function CatalogPage() {
  const [paperTable, milestoneTable, teams] = await Promise.all([
    readJson<Paper[]>("catalog", "papers.json"),
    readJson<Milestone[]>("catalog", "milestones.json"),
    readJson<Team[]>("catalog", "teams.json"),
  ]);

  const papers = queryPapers(paperTable, { offset: 0, pageSize: PAPERS_PAGE_SIZE }); // { items, total }
  const milestones = queryMilestones(milestoneTable, null, MILESTONES_PAGE_SIZE); // { items, nextCursor, hasMore }

  return (
    <SsrProviders>
      <CatalogView papers={papers} milestones={milestones} teams={teams} />
    </SsrProviders>
  );
}
