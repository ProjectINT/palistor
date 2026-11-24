"use client";

import { useForm } from "@palistor";
import type { PalistorProxy } from "@palistor";

import { SelectField, type SelectOption } from "@/components/SelectField";
import { TextField } from "@/components/TextField";
import type { CompanyValues, TeamSize } from "@/config/flow";

const TEAM_SIZE_OPTIONS: ReadonlyArray<SelectOption<TeamSize>> = [
  { value: "1-10", label: "1–10 people" },
  { value: "11-50", label: "11–50 people" },
  { value: "51-200", label: "51–200 people" },
  { value: "200+", label: "200+ people" },
];

/** Rendered only for the Enterprise plan: the step's isVisible hides it for the others. */
export function CompanyStep({ step }: { step: PalistorProxy<CompanyValues> }) {
  const company = useForm(step);

  return (
    <div className="space-y-4">
      <TextField field={company.companyName} />
      <SelectField field={company.teamSize} options={TEAM_SIZE_OPTIONS} />
    </div>
  );
}
