import { gradeTask } from "../harness";
import { checks, type CatalogModule } from "./grade";

gradeTask<CatalogModule>({
  checks,
  solution: () => import("./solution/catalog"),
  mistake: () => import("./mistake/catalog"),
  // mistake/catalog.tsx: "Ignoring ctx.page" — the page number lives in a form field.
  // Without a page cache every revisit refetches, and the page reset that a new
  // search needs is a second request next to the debounced one.
  rejects: [
    "a page that was loaded before is shown again without a request",
    "a burst of keystrokes is one server search that starts at page 1",
  ],
  subject: import.meta.glob("./subject/catalog.tsx"),
});
