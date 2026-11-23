import { gradeTask } from "../harness";
import { checks, type CustomersModule } from "./grade";

gradeTask<CustomersModule>({
  checks,
  solution: () => import("./solution/customersView"),
  mistake: () => import("./mistake/customersView"),
  // mistake/customersView.tsx: "Translator, notifier or context applied through an effect".
  rejects: ["the server's HTML has the customers and the translated label, and the server calls no API"],
  subject: import.meta.glob("./subject/customersView.tsx"),
});
