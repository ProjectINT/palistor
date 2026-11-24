"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@heroui/react";
import { useForm } from "@palistor";
import type { PalistorProxy } from "@palistor";

import { TextField } from "@/components/TextField";
import type { NewUser } from "@/config/catalog/types";

/**
 * The `addUser` group. Its config `onSubmit` adds the row to the users list
 * under a temporary id and rekeys it when the server answers; `afterSubmit`
 * clears the form.
 */
export function AddUserForm({ addUser }: { addUser: PalistorProxy<NewUser> }) {
  const form = useForm(addUser);
  const [failure, setFailure] = useState<string | null>(null);

  const add = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    // Invalid input resolves as { success: false } and shows the errors; it rejects only if onSubmit throws.
    form.submit().catch((error: unknown) => setFailure(error instanceof Error ? error.message : "Could not add the user"));
  };

  return (
    // noValidate: the config validates; the browser's own checks would stop the submit first.
    <form noValidate onSubmit={add} className="space-y-2 pt-3 border-t border-zinc-200 dark:border-zinc-700">
      <div className="flex flex-wrap gap-2 items-start">
        <TextField field={form.name} size="sm" className="flex-1 min-w-32" />
        <TextField field={form.email} size="sm" type="email" className="flex-1 min-w-40" />
        <Button type="submit" color="primary" className="h-12" isDisabled={form.submitting} isLoading={form.submitting}>
          {form.submitting ? "Saving..." : "Add User"}
        </Button>
      </div>
      {failure && <p className="text-xs text-danger">{failure}</p>}
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Temp ID created instantly → server assigns real ID after 800ms (rekey)
      </p>
    </form>
  );
}
