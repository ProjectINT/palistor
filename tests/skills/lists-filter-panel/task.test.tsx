import { gradeTask } from "../harness";
import { checks, type CustomersModule } from "./grade";

gradeTask<CustomersModule>({
  checks,
  solution: () => import("./solution/customers"),
  mistake: () => import("./mistake/customers"),
  // mistake/customers.tsx: "An Apply button over automatic fields" (filtering reference) — the panel binds
  // ordinary (automatic) filter fields with a debounce, so every edit reaches the server before Apply, and
  // Apply sends one request more.
  rejects: [
    "editing the panel changes neither the rows nor the server",
    "Apply is one request for page 1 of the filtered result",
  ],
  subject: import.meta.glob("./subject/customers.tsx"),
});
