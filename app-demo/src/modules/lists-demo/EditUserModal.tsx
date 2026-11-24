"use client";

import { useState, type FormEvent } from "react";
import { Button, Spinner } from "@heroui/react";
import { useForm } from "@palistor";
import type { PalistorEntityProxy, PalistorRef } from "@palistor";

import { SelectField, type SelectOption } from "@/components/SelectField";
import { TextField } from "@/components/TextField";
import type { Role, User, UserDetails } from "@/config/catalog/types";

const ROLES: SelectOption<Role>[] = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "user", label: "User" },
];

type SaveState = { kind: "idle" } | { kind: "saved" } | { kind: "invalid" } | { kind: "failed"; message: string };

interface EditUserModalProps {
  user: PalistorRef<User>;
  /** After a successful save: a submit moves no dirty baseline, so the list reloads the saved rows. */
  onSaved: () => void;
  onClose: () => void;
}

/**
 * One users row through the `editUser` template: fields the list lacks,
 * details loaded when the form opens, a bio that loads on its own, and a save.
 * The form edits the row itself, so the list shows every keystroke.
 */
export function EditUserModal({ user, onSaved, onClose }: EditUserModalProps) {
  // The two-argument form returns `any`: annotate it.
  const form: PalistorEntityProxy<UserDetails> = useForm(user, (s) => s.editUser);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  // The bio has a resolver of its own; its `loading` exists at run time but is missing from the field type.
  const bio = form.bio as typeof form.bio & { loading: boolean };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSave({ kind: "idle" });
    try {
      const result = await form.submit();
      if (!result.success) {
        setSave({ kind: "invalid" });
        return;
      }
      setSave({ kind: "saved" });
      onSaved();
      setTimeout(onClose, 1500);
    } catch (error) {
      // onSubmit threw: the server refused the save.
      setSave({ kind: "failed", message: error instanceof Error ? error.message : "Failed to save" });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-title"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        noValidate
        onSubmit={submit}
        className="bg-white dark:bg-zinc-900 rounded-xl p-6 w-full max-w-md shadow-xl space-y-4 mx-4"
      >
        <h3 id="edit-user-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Edit User
        </h3>

        {/* The template resolve runs once per row, when the form mounts. */}
        {form.loading ? (
          <div className="flex items-center gap-2 text-zinc-500 py-4">
            <Spinner size="sm" />
            Loading details...
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              name / email / role / department / phone — template resolve (500ms) · bio — field resolve (700ms)
            </p>
            <TextField field={form.name} size="sm" />
            <TextField field={form.email} size="sm" type="email" />
            <SelectField field={form.role} options={ROLES} size="sm" />
            {/* Reading bio.loading starts the bio's request, for this row only. */}
            {bio.loading ? <LoadingBio /> : <TextField field={form.bio} size="sm" />}
            <TextField field={form.department} size="sm" />
            <TextField field={form.phone} size="sm" />
          </div>
        )}

        {save.kind === "saved" && (
          <p className="text-sm text-success bg-success-50 rounded-lg px-3 py-2">✓ User saved successfully</p>
        )}
        {save.kind === "failed" && (
          <p className="text-sm text-danger bg-danger-50 rounded-lg px-3 py-2">✕ {save.message}</p>
        )}
        {save.kind === "invalid" && <p className="text-xs text-warning">⚠ Fix validation errors before saving</p>}

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-amber-500">{form.dirty && "● Unsaved changes"}</span>
          <div className="flex gap-2">
            <Button variant="flat" isDisabled={form.submitting} onPress={onClose}>
              Close
            </Button>
            <Button
              type="submit"
              color="primary"
              isDisabled={form.loading || form.submitting}
              isLoading={form.submitting}
            >
              {form.submitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function LoadingBio() {
  return (
    <div className="flex items-center gap-2 h-12 px-3 rounded-medium bg-default-100 text-sm text-zinc-500">
      <Spinner size="sm" />
      Loading bio…
    </div>
  );
}
