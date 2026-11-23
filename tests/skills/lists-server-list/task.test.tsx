import { gradeTask } from "../harness";
import { checks, type MembersModule } from "./grade";

gradeTask<MembersModule>({
  checks,
  solution: () => import("./solution/members"),
  mistake: () => import("./mistake/members"),
  // mistake/members.tsx: "Treating a failed or not-yet-started list as empty". Its `loading` check covers
  // the first render (`loading` is true from the read that starts the load), so only the failure slips through.
  rejects: ["a failed load shows the error, not the empty state, and Retry loads again"],
  subject: import.meta.glob("./subject/members.tsx"),
});
