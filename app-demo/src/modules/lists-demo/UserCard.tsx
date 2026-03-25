"use client";

interface UserCardProps {
  user: any;
  onEdit: () => void;
  onRemove: () => void;
}

export function UserCard({ user, onEdit, onRemove }: UserCardProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
          {user.name.value || <span className="text-zinc-400 italic">No name</span>}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400 text-sm truncate">
          {user.email.value}
        </span>
        {user.role.value && (
          <span className="text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-full flex-shrink-0">
            {user.role.value}
          </span>
        )}
      </div>
      <div className="flex gap-2 flex-shrink-0 ml-3">
        <button
          onClick={onEdit}
          className="text-blue-500 hover:text-blue-700 text-sm font-medium transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onRemove}
          className="text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
