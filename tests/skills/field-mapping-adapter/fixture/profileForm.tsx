import { Palistor } from "palistor";
import { saveProfile, type ProfileValues } from "./api";
import { Checkbox } from "./ui/Checkbox";
import { TextField } from "./ui/TextField";

// TODO: the profile form — see task.md.

export const profileStore = new Palistor({
  config: {
    onSubmit: (values: ProfileValues) => saveProfile(values),
  },
});

export function ProfileForm() {
  void TextField;
  void Checkbox;
  return null;
}
