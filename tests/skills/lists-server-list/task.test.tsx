import { gradeTask } from "../harness";
import { checks, type MembersModule } from "./grade";

gradeTask<MembersModule>({
  checks,
  solution: () => import("./solution/members"),
  mistake: () => import("./mistake/members"),
  // mistake/members.tsx: "Treating a failed or not-yet-started list as empty". Its `loading` check covers
  // the first render (`loading` is true from the read that starts the load), so only the failure slips through.
  rejects: ["a failed load shows the error, not the empty state, and Retry loads again"],
  mistakes: [
    {
      // mistake/members-client-sort.tsx: "Sorting in the browser what only the server has" (sorting reference):
      // a client sort of the first 50 members, so a click sends no request.
      name: "client sort of a server-limited list",
      load: () => import("./mistake/members-client-sort"),
      rejects: ["the Name button asks the API to sort: one request per click, rows in the API's order"],
    },
  ],
  subject: import.meta.glob("./subject/members.tsx"),
});
