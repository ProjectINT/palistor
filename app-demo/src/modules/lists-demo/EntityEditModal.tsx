"use client";

import { useForm } from "@palistor/react/useForm";
import { catalogStore, useCatalogForm } from "@/config/catalog/catalogConfig";

interface EntityEditModalProps {
  entityId: string;
  onClose: () => void;
}

export function EntityEditModal({ entityId, onClose }: EntityEditModalProps) {
  const form = useCatalogForm();
  const entity = form.users.getById(entityId);

  if (!entity) return null;

  // Entity Projection: entity + template = reactive form
  const editForm = useForm(entity, (s: any) => s.editUser) as any;

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
            <Field label={editForm.name.label} value={editForm.name.value} onChange={editForm.name.onValueChange} placeholder="Name" required={editForm.name.isRequired} error={editForm.name.isInvalid ? editForm.name.errorMessage : undefined} />
            <Field label={editForm.email.label} value={editForm.email.value} onChange={editForm.email.onValueChange} placeholder="Email" required={editForm.email.isRequired} error={editForm.email.isInvalid ? editForm.email.errorMessage : undefined} />
            <Field label={editForm.role.label} value={editForm.role.value} onChange={editForm.role.onValueChange} placeholder="Role" />
            <Field label={editForm.bio.label} value={editForm.bio.value} onChange={editForm.bio.onValueChange} placeholder="Bio" />
            <Field label={editForm.department.label} value={editForm.department.value} onChange={editForm.department.onValueChange} placeholder="Department" />
            <Field label={editForm.phone.label} value={editForm.phone.value} onChange={editForm.phone.onValueChange} placeholder="Phone" />
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm font-medium transition-colors"
          >
            Close
          </button>
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
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <div>
      {label && (
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-lg border text-sm bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          error
            ? "border-red-400 dark:border-red-500"
            : "border-zinc-300 dark:border-zinc-600"
        }`}
      />
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}
