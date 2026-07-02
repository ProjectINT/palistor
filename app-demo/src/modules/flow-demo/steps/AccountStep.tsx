"use client";

import { Input } from "@/components/Input";

/**
 * Шаг 1 — данные аккаунта. Презентационный компонент: поля спредятся из
 * step-proxy (`{...step.fullName}`), навигация и submit живут в контейнере.
 */
export function AccountStep({ step }: { step: any }) {
  return (
    <div className="space-y-4">
      <Input {...step.fullName} />
      <Input
        {...step.email}
        type="email"
      />
    </div>
  );
}
