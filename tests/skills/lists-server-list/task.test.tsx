import { gradeTask } from "../harness";
import { checks, type MembersModule } from "./grade";

gradeTask<MembersModule>({
  checks,
  solution: () => import("./solution/members"),
  mistake: () => import("./mistake/members"),
  // mistake/members.tsx: "Treating a failed or not-yet-started list as empty".
  rejects: [
    "loads the members; the empty state never shows before the load finished",
    "a failed load shows the error, not the empty state, and Retry loads again",
  ],
  subject: import.meta.glob("./subject/members.tsx"),
});
