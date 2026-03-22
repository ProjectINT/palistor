"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { useCatalogForm } from "@/config/catalog/catalogConfig";
import { AddUserForm } from "./AddUserForm";
import { EntityEditModal } from "./EntityEditModal";
import { UserCard } from "./UserCard";

export function UsersListSection() {
  const form = useCatalogForm();
  const [editingId, setEditingId] = useState<string | null>(null);

  const users = form.users;

  return (
    <div className="space-y-4">
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
      </div>

      {/* User list */}
      <div className="space-y-2">
        {users.map((user: any, _index: number, id: string) => (
          <UserCard
            key={id}
            user={user}
            onEdit={() => setEditingId(id)}
            onRemove={() => users.remove(id)}
          />
        ))}
      </div>

      {!users.loading && users.length === 0 && (
        <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">No users loaded</p>
      )}

      {/* Add user form */}
      <AddUserForm onAdd={(data: Record<string, unknown>) => users.add(data)} />

      {/* Entity edit modal */}
      {editingId && (
        <EntityEditModal entityId={editingId} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
