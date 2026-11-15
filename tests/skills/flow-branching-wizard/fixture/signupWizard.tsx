import { Palistor } from "palistor";
import { completeSignup } from "./api";

// TODO: the signup wizard — see task.md.

export const signupStore = new Palistor({ config: {} });

export function SignupWizard() {
  void completeSignup;
  return null;
}
