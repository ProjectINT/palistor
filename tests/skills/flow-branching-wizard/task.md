# Task: signup wizard

Skill under test: `palistor-flows`.

We need a signup wizard. The project is React + TypeScript and already has `palistor` installed.
Put everything in `signupWizard.tsx` and export two things from it:

- `signupStore` — the wizard's store;
- `SignupWizard` — the component.

`api.ts` next to it is our backend client; call its `completeSignup(payload)` to finish the signup
and do not change that file.

The steps, in order:

1. **Account** — `Full name` (required, at least 2 characters) and `Email` (required, must contain `@`).
2. **Plan** — radio buttons `Free`, `Pro` and `Enterprise`. A plan must be picked.
3. **Company** — `Company name` (required). Only customers on the Enterprise plan see this step.
4. **Summary** — a read-only review of what was entered.

What the wizard does:

- A **Next** button moves forward. It must not leave a step that has invalid fields: the invalid
  inputs get `aria-invalid="true"` and their messages are rendered in elements with `role="alert"`.
- A **Back** button returns to the step the customer came from. It is disabled on the first step.
- On the summary step the forward button reads **Finish**. It calls `completeSignup(payload)` once
  and, when that succeeds, the wizard shows the text `Signup complete` instead of the steps.
- `payload` is `{ fullName, email, plan }`, plus `companyName` for Enterprise customers only — also
  when the customer filled in the company step and then went back and picked another plan.

Our UI tests find the text inputs by their labels — `Full name`, `Email`, `Company name` (the label
text must start with those words) — the plans as radio buttons named `Free`, `Pro`, `Enterprise`,
and the buttons by their names: `Back`, `Next`, `Finish`.
