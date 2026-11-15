// Task check for the `palistor-field-mapping` skill: a mapped store rendered
// through one adapter per input kind. The mistake is the skill's "Spreading a
// field where palistor-only props are not consumed": the adapter forwards the
// whole field, so a hidden field still renders and library props reach the DOM.
import { gradeTask } from "../harness";
import { checks, type ProfileModule } from "./grade";

gradeTask<ProfileModule>({
  checks,
  solution: () => import("./solution/profileForm"),
  mistake: () => import("./mistake/profileForm"),
  rejects: [
    "a hidden field leaves nothing in the DOM",
    "nothing but real input attributes reaches the DOM",
  ],
  subject: import.meta.glob("./subject/profileForm.tsx"),
});
