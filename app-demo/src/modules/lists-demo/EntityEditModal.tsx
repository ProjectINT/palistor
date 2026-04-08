"use client";

import { useState } from "react";
import { useForm } from "@palistor/react/useForm";
import { useCatalogForm } from "@/config/catalog/catalogConfig";

interface EntityEditModalProps {
  entityId: string;
  onClose: () => void;
}

export function EntityEditModal({ entityId, onClose }: EntityEditModalProps) {
  const form = useCatalogForm();
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const entity = form.users.getById(entityId);
  if (!entity) return null;

  // Entity Projection: entity + editUser template = reactive form with separate fields/validators/resolve
  const editForm = useForm(entity, (s: any) => s.editUser) as any;

  const handleSubmit = async () => {
    setSubmitStatus("idle");
    setSubmitError(null);
    try {
      const result = await editForm.submit();
      if (result.success) {
        setSubmitStatus("success");
        setTimeout(onClose, 1500);
      }
    } catch (err) {
      setSubmitStatus("error");
      setSubmitError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 w-full max-w-md shadow-xl space-y-4 mx-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Edit User</h3>

        {editForm.loading ? (
          <div className="flex items-center gap-2 text-zinc-500 py-4">
            <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Loading details...
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2">
              name / email / role / department / phone — template resolve (500ms) · bio — per-field lazy resolve (700ms)
            </div>
            <Field
              label={editForm.name.label}
              value={editForm.name.value}
              onChange={editForm.name.onValueChange}
              placeholder="Name"
              required={editForm.name.isRequired}
              error={editForm.name.isInvalid ? editForm.name.errorMessage : undefined}
              dirty={editForm.name.dirty}
            />
            <Field
              label={editForm.email.label}
              value={editForm.email.value}
              onChange={editForm.email.onValueChange}
              placeholder="Email"
              required={editForm.email.isRequired}
              error={editForm.email.isInvalid ? editForm.email.errorMessage : undefined}
              dirty={editForm.email.dirty}
            />
            <Field
              label={editForm.role.label}
              value={editForm.role.value}
              onChange={editForm.role.onValueChange}
              placeholder="Role"
              dirty={editForm.role.dirty}
            />
            <BioField
              label={editForm.bio.label}
              value={editForm.bio.value}
              onChange={editForm.bio.onValueChange}
              placeholder={editForm.bio.placeholder}
              loading={editForm.bio.loading}
              dirty={editForm.bio.dirty}
            />
            <Field
              label={editForm.department.label}
              value={editForm.department.value}
              onChange={editForm.department.onValueChange}
              placeholder="Department"
              dirty={editForm.department.dirty}
            />
            <Field
              label={editForm.phone.label}
              value={editForm.phone.value}
              onChange={editForm.phone.onValueChange}
              placeholder="Phone"
              dirty={editForm.phone.dirty}
            />

            {/* Legend */}
            <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-800 pt-3 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block flex-shrink-0" />
              Field changed since opening
            </div>
          </div>
        )}

        {/* Submit result feedback */}
        {submitStatus === "success" && (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
            <span>✓</span> User saved successfully
          </div>
        )}
        {submitStatus === "error" && submitError && (
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
            <span>✕</span> {submitError}
          </div>
        )}
        {!editForm.loading && editForm.isInvalid && (
          <div className="text-amber-600 dark:text-amber-400 text-xs">
            ⚠ Fix validation errors before saving
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {/* Dirty status indicator */}
          <div className="text-xs text-zinc-500">
            {!editForm.loading && editForm.dirty && (
              <span className="flex items-center gap-1 text-amber-500">
                <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                Unsaved changes
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={editForm.submitting}
              className="px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm font-medium transition-colors disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={handleSubmit}
              disabled={editForm.submitting || editForm.loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {editForm.submitting && (
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {editForm.submitting ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  error,
  dirty,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
  dirty?: boolean;
}) {
  return (
    <div>
      {label && (
        <label className="flex items-center gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
          {dirty && (
            <span
              title="Modified"
              className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block ml-0.5"
            />
          )}
        </label>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-lg border text-sm bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          error
            ? "border-red-400 dark:border-red-500"
            : dirty
              ? "border-amber-400 dark:border-amber-500"
              : "border-zinc-300 dark:border-zinc-600"
        }`}
      />
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}

function BioField({
  label,
  value,
  onChange,
  placeholder,
  loading,
  dirty,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  loading?: boolean;
  dirty?: boolean;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
        {label ?? "Bio"}
        {loading && (
          <span className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
        )}
        {loading && <span className="text-zinc-400">lazy resolve…</span>}
        {!loading && dirty && (
          <span
            title="Modified"
            className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"
          />
        )}
      </label>
      {loading ? (
        <div className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 min-h-[38px]">
          Fetching bio...
        </div>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "Tell about yourself..."}
          className={`w-full px-3 py-2 rounded-lg border text-sm bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            dirty
              ? "border-amber-400 dark:border-amber-500"
              : "border-zinc-300 dark:border-zinc-600"
          }`}
        />
      )}
    </div>
  );
}
