import { gradeTask } from "../harness";
import { checks, type AppStoreModule } from "./grade";

gradeTask<AppStoreModule>({
  checks,
  solution: () => import("./solution/appStore"),
  mistake: () => import("./mistake/appStore"),
  // mistake/appStore.tsx: "`usePalistor` called in every component that needs the shared store".
  rejects: [
    "typing in the settings input changes the badge in the header",
    "what was typed is still there after navigating to another page and back",
  ],
  subject: import.meta.glob("./subject/appStore.tsx"),
});
