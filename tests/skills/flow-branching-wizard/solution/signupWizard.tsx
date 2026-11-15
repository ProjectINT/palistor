import { useState } from "react";
import { Palistor, defineFlow, defineStep, useForm } from "palistor";
import type { FieldProxyNode } from "palistor";
import { completeSignup, type SignupPayload } from "./api";

type Plan = SignupPayload["plan"];

const PLANS: ReadonlyArray<{ id: Plan; name: string }> = [
  { id: "free", name: "Free" },
  { id: "pro", name: "Pro" },
  { id: "enterprise", name: "Enterprise" },
];

// A step's onSubmit runs only after the step validated; its third argument is the flow.
const advance = (_values: unknown, _store: unknown, flow: { nextStep(): void }) => flow.nextStep();

const signup = defineFlow({
  steps: [
    defineStep("account", {
      fullName: {
        value: "" as string,
        label: "Full name",
        isRequired: true,
        validate: (v: string) => (v.trim().length < 2 ? "Enter at least 2 characters" : undefined),
      },
      email: {
        value: "" as string,
        label: "Email",
        isRequired: true,
        validate: (v: string) => (v.includes("@") ? undefined : "Enter a valid email"),
      },
      onSubmit: advance,
    }),
    defineStep("plan", {
      plan: { value: "" as Plan | "", isRequired: true },
      onSubmit: advance,
    }),
    defineStep("company", {
      companyName: { value: "" as string, label: "Company name", isRequired: true },
      // Step-level condition: it receives the values of all steps.
      isVisible: (values: { plan: { plan: Plan | "" } }) => values.plan.plan === "enterprise",
      onSubmit: advance,
    }),
    defineStep("summary", {}),
  ],
  // The values of a branch the customer left stay in the flow: build the payload explicitly.
  onSubmit: async ({ account, plan, company }) => {
    const payload: SignupPayload = { ...account, plan: plan.plan as Plan };
    if (plan.plan === "enterprise") payload.companyName = company.companyName;
    return completeSignup(payload);
  },
});

export const signupStore = new Palistor({ config: { signup } });

function TextField(props: FieldProxyNode<string>) {
  const { isVisible, label, value, onValueChange, isInvalid, errorMessage } = props;
  if (!isVisible) return null;
  return (
    <div>
      <label>
        {label}
        <input
          value={value}
          aria-invalid={isInvalid || undefined}
          onChange={(e) => onValueChange(e.target.value)}
        />
      </label>
      {isInvalid && errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </div>
  );
}

export function SignupWizard() {
  const flow = useForm(signupStore).signup;
  const [done, setDone] = useState(false);

  if (done) return <p>Signup complete</p>;

  const key = flow.currentStepKey;
  const isLast = key === "summary";
  const plan = flow.steps.plan.plan;

  const forward = async () => {
    if (!isLast) {
      await flow.steps.current.submit(); // validates the step, then its onSubmit advances
      return;
    }
    const result = await flow.submit(); // validates every visible step, then the flow's onSubmit
    if (result.success) setDone(true);
  };

  return (
    <div>
      {key === "account" && (
        <>
          <TextField {...flow.steps.account.fullName} />
          <TextField {...flow.steps.account.email} />
        </>
      )}
      {key === "plan" && (
        <fieldset>
          {PLANS.map(({ id, name }) => (
            <label key={id}>
              <input
                type="radio"
                name="plan"
                checked={plan.value === id}
                onChange={() => plan.onValueChange(id)}
              />
              {name}
            </label>
          ))}
          {plan.isInvalid && plan.errorMessage ? <p role="alert">{plan.errorMessage}</p> : null}
        </fieldset>
      )}
      {key === "company" && <TextField {...flow.steps.company.companyName} />}
      {key === "summary" && (
        <dl>
          <dt>Name</dt>
          <dd>{flow.values.account.fullName}</dd>
          <dt>Email</dt>
          <dd>{flow.values.account.email}</dd>
          <dt>Plan</dt>
          <dd>{flow.values.plan.plan}</dd>
        </dl>
      )}

      <button type="button" disabled={!flow.canGoBack} onClick={() => flow.back()}>
        Back
      </button>
      <button type="button" disabled={flow.submitting} onClick={forward}>
        {isLast ? "Finish" : "Next"}
      </button>
    </div>
  );
}
