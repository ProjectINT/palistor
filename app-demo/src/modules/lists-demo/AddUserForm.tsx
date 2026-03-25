"use client";

import { useState } from "react";

interface AddUserFormProps {
  onAdd: (data: Record<string, unknown>) => void;
}

export function AddUserForm({ onAdd }: AddUserFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const handleAdd = () => {
    if (!name || !email) return;
    onAdd({ name, email, role: "user" });
    setName("");
    setEmail("");
  };

  return (
    <div className="flex flex-wrap gap-2 items-end pt-3 border-t border-zinc-200 dark:border-zinc-700">
      <div className="flex-1 min-w-32">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex-1 min-w-40">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <button
        onClick={handleAdd}
        disabled={!name || !email}
        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
      >
        Add User
      </button>
    </div>
  );
}
