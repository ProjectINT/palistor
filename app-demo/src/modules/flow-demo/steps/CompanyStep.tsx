"use client";

import { Input } from "@/components/Input";
import { Select, type SelectOption } from "@/components/Select";
import { TEAM_SIZE_OPTIONS } from "@/config/flow";

/**
 * Шаг 3 — данные компании. Существует во флоу только для плана Enterprise
 * (`isVisible` шага). Для Free / Pro `nextStep()` его пропускает, и сюда
 * пользователь не попадает.
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
