// Task check for the `palistor` skill: a form with dependent fields.
// The mistake is the skill's "A hidden field still blocks submit": the address
// is hidden for pickup but unconditionally required.
import { gradeTask } from "../harness";
import { checks, type DeliveryModule } from "./grade";

gradeTask<DeliveryModule>({
  checks,
  solution: () => import("./solution/deliveryForm"),
  mistake: () => import("./mistake/deliveryForm"),
  rejects: ["a hidden address does not block the order"],
  subject: import.meta.glob("./subject/deliveryForm.tsx"),
});
