import { gradeTask } from "../harness";
import { checks, type ProductsModule } from "./grade";

gradeTask<ProductsModule>({
  checks,
  solution: () => import("./solution/products"),
  mistake: () => import("./mistake/products"),
  // mistake/products.tsx: "Sorting rows in the component" (sorting reference) — the current page is sliced
  // out of the loaded rows and sorted in a useMemo, so a sort orders the five rows on screen, not the list.
  rejects: [
    "a header click sorts all products, not only the page on screen",
    "an edited price stays in place until Re-sort",
  ],
  subject: import.meta.glob("./subject/products.tsx"),
});
