# Task: profile form on our design system

Skill under test: `palistor-field-mapping`.

The project is React + TypeScript and already has `palistor` installed. Our design system lives in
`ui/` (`TextField`, `Checkbox`). Its components take the usual prop names — `label`, `value`,
`onChange(event)`, `required`, `disabled`, `readOnly`, `error`, `helperText` — and, like most UI
kits, forward every prop they do not know to the underlying `<input>`. Do not change `ui/` or
`api.ts`.

Build the profile form in `profileForm.tsx` and export two things from it:

- `profileStore` — the form's store;
- `ProfileForm` — the component.

We want forms on this design system to be cheap to write and to read:

- a field is rendered in one line, by spreading it into a small wrapper component — no per-field
  prop wiring in the form;
- the form speaks the design system's vocabulary everywhere: other code reads
  `profileStore.proxy.email.required`, `.disabled`, `.readOnly`, `.error` and `.helperText`, and a
  spread of a field carries those names instead of the library's own.

The fields:

- **Email** (`email`) — required and must contain `@`, otherwise the message is
  `Enter a valid email`. Hint: `We never share it`.
- **Nickname** (`nickname`) — starts as `guest_42` and is read-only.
- **I represent a company** (`hasCompany`) — a checkbox, off by default.
- **Company** (`company`) — shown only while the checkbox is on, and required only then.

What the form does:

- Under each text input the design system's helper text shows the validation message while the
  field is invalid, otherwise the field's hint (if it has one).
- A **Save** button submits the form. With valid values it calls `saveProfile(values)` from
  `./api` with the form values: `email`, `nickname`, `hasCompany`, `company`.
- A hidden field leaves nothing in the DOM, and the browser console stays free of React warnings
  about unknown props.

Our UI tests find the inputs by their labels — `Email`, `Nickname`, `Company`,
`I represent a company` (the label text must start with those words) — and the button by its
name, `Save`.
