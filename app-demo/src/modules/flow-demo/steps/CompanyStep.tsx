"use client";

import { Input } from "@/components/Input";
import { Select, type SelectOption } from "@/components/Select";
import { TEAM_SIZE_OPTIONS } from "@/config/flow";

/**
 * Step 3 — the company details. Exists in the flow only for the Enterprise
 * plan (the step's `isVisible`). For Free / Pro `nextStep()` skips it, and
 * the user never lands here.
 */
export function CompanyStep({ step }: { step: any }) {
  const options: SelectOption[] = TEAM_SIZE_OPTIONS;

  return (
    <div className="space-y-4">
      <Input {...step.companyName} />
      <Select
        options={options}
        selectedKeys={step.teamSize.value ? [step.teamSize.value] : []}
        onSelectionChange={(keys: "all" | Set<React.Key>) => {
          const value = Array.from(keys as Set<React.Key>)[0] as string;
          step.teamSize.value = value;
        }}
        {...step.teamSize}
      />
    </div>
  );
}
