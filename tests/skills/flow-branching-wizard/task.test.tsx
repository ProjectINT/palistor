// Task check for the `palistor-flows` skill: a branching signup wizard.
// The mistake is the skill's "Calling flow.nextStep() from the Next button":
// navigation without the step's submit, so invalid steps are walked over.
import { gradeTask } from "../harness";
import { checks, type SignupModule } from "./grade";

gradeTask<SignupModule>({
  checks,
  solution: () => import("./solution/signupWizard"),
  mistake: () => import("./mistake/signupWizard"),
  rejects: [
    "Next does not leave an invalid account step",
    "a plan must be picked before moving on",
    "Enterprise goes through the company step, which needs a name",
  ],
  subject: import.meta.glob("./subject/signupWizard.tsx"),
});
