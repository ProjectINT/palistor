"use client";

import { Input } from "@/components/Input";

/**
 * Step 1 — the account details. A presentational component: fields spread
 * from the step proxy (`{...step.fullName}`); navigation and submit live in
 * the container.
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
