"use client";

import { useForm } from "@palistor";
import type { PalistorProxy } from "@palistor";

import { TextField } from "@/components/TextField";
import type { AccountValues } from "@/config/flow";

/** Hands each field to its input; reads no state itself. */
export function AccountStep({ step }: { step: PalistorProxy<AccountValues> }) {
  const account = useForm(step);

  return (
    <div className="space-y-4">
      <TextField field={account.fullName} />
      <TextField field={account.email} type="email" />
    </div>
  );
}
