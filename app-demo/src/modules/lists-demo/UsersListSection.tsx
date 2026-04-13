"use client";

import { useState } from "react";
import { useCatalogForm, catalogStore } from "@/config/catalog/catalogConfig";
import { AddUserForm } from "./AddUserForm";
import { EntityEditModal } from "./EntityEditModal";
import { UserCard } from "./UserCard";

export function UsersListSection() {
  const form = useCatalogForm();
  const [editingId, setEditingId] = useState<string | null>(null);

  const users = form.users;

  const handleRefreshList = () => {
    const current = (form.usersRefreshKey as any).value as number;
    (form.usersRefreshKey as any).onValueChange(current + 1);
  };

  const handleDelete = (id: string) => {
    users.remove(id);
    catalogStore.delete(id);
  };

  const handleInvalidate = (id: string) => {
    catalogStore.invalidate(id);
  };

  return (
    <div className="space-y-4">
      {/* Lifecycle explanation */}
      <div className="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 space-y-0.5">
        <div><span className="font-medium text-zinc-500 dark:text-zinc-400">Add</span> → temp ID instantly → <span className="font-medium text-zinc-500 dark:text-zinc-400">rekey</span> when server responds (800ms)</div>
        <div><span className="font-medium text-zinc-500 dark:text-zinc-400">Remove</span> = list only · <span className="font-medium text-zinc-500 dark:text-zinc-400">Delete</span> = list + registry · <span className="font-medium text-zinc-500 dark:text-zinc-400">↻</span> = invalidate resolve cache</div>
        <div><span className="font-medium text-zinc-500 dark:text-zinc-400">status…</span> badge = per-entity field resolver — auto-triggers after list loads, each user resolves independently</div>
      </div>

      {/* List status */}
      <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
        <span>Count: {users.length}</span>
        {users.loading && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block" />
            Loading...
          </span>
        )}
        {users.dirty && <span className="text-amber-500">● Modified</span>}
        <button
          onClick={handleRefreshList}
          disabled={users.loading}
          className="ml-auto flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          ↻ Refresh List
        </button>
      </div>

      {/* User list */}
      <div className="space-y-2">
        {users.map((user: any, _index: number, id: string) => (
          <UserCard
            key={id}
            user={user}
            onEdit={(currentId) => setEditingId(currentId)}
            onRemove={(currentId) => users.remove(currentId)}
            onDelete={handleDelete}
            onInvalidate={handleInvalidate}
          />
        ))}
      </div>

      {!users.loading && users.length === 0 && (
        <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">No users loaded</p>
      )}

      {/* Add user form */}
      <AddUserForm />

      {/* Entity edit modal */}
      {editingId && (
        <EntityEditModal entityId={editingId} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
