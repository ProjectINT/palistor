"use client";

import { useForm } from "@palistor/react/useForm";

interface UserCardProps {
  user: any;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onDelete: (id: string) => void;
  onInvalidate: (id: string) => void;
}

export function UserCard({ user, onEdit, onRemove, onDelete, onInvalidate }: UserCardProps) {
  // Subscribe directly to the entity so rekey() → id leaf notify → re-render here.
  // Without useForm the parent's stale closure would keep id="_tmp_xxx" forever.
  const u = useForm(user) as any;
  const currentId = u.id as string | undefined;
  const isTemp = currentId?.startsWith("_tmp_") ?? false;

  // Entity may be briefly in-flight between delete() and list re-render unmount
  if (!currentId) return null;

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
        isTemp
          ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700"
          : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
          {u.name.value || <span className="text-zinc-400 italic">No name</span>}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400 text-sm truncate">
          {u.email.value}
        </span>
        {isTemp ? (
          <span className="flex items-center gap-1 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full flex-shrink-0">
            <span className="w-2 h-2 border border-amber-500 border-t-transparent rounded-full animate-spin" />
            Saving...
          </span>
        ) : (
          u.role.value && (
            <span className="text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-full flex-shrink-0">
              {u.role.value}
            </span>
          )
        )}
      </div>
      <div className="flex gap-2 flex-shrink-0 ml-3">
        {!isTemp && (
          <>
            <button
              onClick={() => onEdit(currentId)}
              className="text-blue-500 hover:text-blue-700 text-sm font-medium transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => onInvalidate(currentId)}
              title="Invalidate resolve cache — next edit open re-fetches from server"
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-sm transition-colors"
            >
              ↻
            </button>
          </>
        )}
        <button
          onClick={() => onRemove(currentId)}
          title="Remove from list only (entity stays in registry)"
          className="text-amber-500 hover:text-amber-700 text-sm font-medium transition-colors"
        >
          Remove
        </button>
        {!isTemp && (
          <button
            onClick={() => onDelete(currentId)}
            title="Delete entity from registry (full delete)"
            className="text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
