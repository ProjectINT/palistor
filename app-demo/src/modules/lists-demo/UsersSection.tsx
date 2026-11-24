"use client";

import { useState } from "react";
import { Button, Chip, Spinner } from "@heroui/react";
import { useForm } from "@palistor";
import type { PalistorList, PalistorProxy, PalistorRef } from "@palistor";

import type { NewUser, User } from "@/config/catalog/types";
import { AddUserForm } from "./AddUserForm";
import { EditUserModal } from "./EditUserModal";
import { Hint, ListError } from "./ui";

interface UsersSectionProps {
  users: PalistorList<User>;
  addUser: PalistorProxy<NewUser>;
  /** `store.delete`: the user leaves the registry and every list. */
  onDelete: (id: string) => void;
  /** `store.invalidate`: the edit form loads the user's details again when it opens next. */
  onInvalidate: (id: string) => void;
}

/** A list loaded by its resolver: rows, membership changes, a row field resolve and an edit form. */
export function UsersSection({ users, addUser, onDelete, onInvalidate }: UsersSectionProps) {
  const list = useForm(users);
  const count = list.length; // the first read starts the lazy load: keep it above every branch
  const [editingId, setEditingId] = useState<string | null>(null);
  // A row from getById goes to the two-argument useForm, inside the modal.
  const editing = editingId ? list.getById(editingId) : undefined;

  return (
    <div className="space-y-4">
      <Hint>
        <div><b>Add</b> → temp ID instantly → <b>rekey</b> when the server responds (800ms)</div>
        <div><b>Remove</b> = this list only · <b>Delete</b> = list + registry · <b>↻</b> = invalidate: the next Edit loads the details again</div>
        <div><b>status…</b> = a field resolve: each row loads its own status when it first shows it</div>
      </Hint>

      <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
        <span>Count: {count}</span>
        {list.loading && (
          <span className="flex items-center gap-1">
            <Spinner size="sm" />
            Loading...
          </span>
        )}
        {list.dirty && <span className="text-amber-500">● Modified</span>}
        <Button size="sm" variant="flat" className="ml-auto" isDisabled={list.loading} onPress={() => list.reload()}>
          ↻ Refresh List
        </Button>
      </div>

      {list.resolveStatus === "error" ? (
        <ListError error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="space-y-2">
          {list.map((user, _index, id) => (
            <UserRow
              key={id}
              user={user}
              onEdit={setEditingId}
              onRemove={(rowId) => list.remove(rowId)}
              onDelete={onDelete}
              onInvalidate={onInvalidate}
            />
          ))}
        </div>
      )}
      {list.resolveStatus === "resolved" && count === 0 && (
        <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">No users loaded</p>
      )}

      <AddUserForm addUser={addUser} />

      {editing && (
        <EditUserModal key={editingId} user={editing} onSaved={() => list.reload()} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}

interface UserRowProps {
  user: PalistorRef<User>;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onDelete: (id: string) => void;
  onInvalidate: (id: string) => void;
}

function UserRow({ user, onEdit, onRemove, onDelete, onInvalidate }: UserRowProps) {
  const row = useForm(user); // the row's own subscription: an edit or a rekey re-renders this row only
  const id = row.id; // follows store.rekey
  const saving = id.startsWith("_tmp_"); // added here, not confirmed by the server yet
  // A field resolve's `loading` exists at run time but is missing from the field type.
  const status = row.isActive as typeof row.isActive & { loading: boolean };

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
        saving
          ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700"
          : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{row.name.value}</span>
        <span className="text-zinc-500 dark:text-zinc-400 text-sm truncate">{row.email.value}</span>
        {saving ? (
          <Chip size="sm" variant="flat" color="warning">
            Saving...
          </Chip>
        ) : (
          <>
            <Chip size="sm" variant="flat">
              {row.role.value}
            </Chip>
            {/* `isActive` has a resolver of its own: this read starts the request for this row. */}
            <StatusChip loading={status.loading} online={status.value} />
          </>
        )}
      </div>
      <div className="flex gap-1 flex-shrink-0 ml-3">
        {!saving && (
          <>
            <Button size="sm" variant="light" color="primary" onPress={() => onEdit(id)}>
              Edit
            </Button>
            <Button size="sm" variant="light" title="Invalidate: the next Edit loads the details again" onPress={() => onInvalidate(id)}>
              ↻
            </Button>
          </>
        )}
        <Button size="sm" variant="light" color="warning" title="Remove from this list (the entity stays in the registry)" onPress={() => onRemove(id)}>
          Remove
        </Button>
        {!saving && (
          <Button size="sm" variant="light" color="danger" title="Delete the entity everywhere" onPress={() => onDelete(id)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusChip({ loading, online }: { loading: boolean; online: boolean | null | undefined }) {
  if (loading) {
    return (
      <Chip size="sm" variant="bordered" title="Loaded by the row's field resolver">
        status…
      </Chip>
    );
  }
  if (typeof online !== "boolean") return null; // not loaded, or the request failed
  return (
    <Chip size="sm" variant="flat" color={online ? "success" : "default"}>
      {online ? "● online" : "○ offline"}
    </Chip>
  );
}
