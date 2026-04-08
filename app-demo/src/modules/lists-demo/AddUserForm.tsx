"use client";

import { useState } from "react";
import { useCatalogForm } from "@/config/catalog/catalogConfig";

export function AddUserForm() {
  const form = useCatalogForm();
  const addUser = (form as any).addUser;

  const handleAdd = async () => {
    await addUser.submit();
  };

  return (
    <div className="space-y-2 pt-3 border-t border-zinc-200 dark:border-zinc-700">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-32">
          <input
            value={addUser.name.value}
            onChange={(e) => addUser.name.onValueChange(e.target.value)}
            placeholder="Name"
            disabled={addUser.submitting}
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>
        <div className="flex-1 min-w-40">
          <input
            value={addUser.email.value}
            onChange={(e) => addUser.email.onValueChange(e.target.value)}
            placeholder="Email"
            disabled={addUser.submitting}
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={!addUser.name.value || !addUser.email.value || addUser.submitting}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {addUser.submitting && (
            <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          {addUser.submitting ? "Saving..." : "Add User"}
        </button>
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Temp ID created instantly → server assigns real ID after 800ms (rekey)
      </p>
    </div>
  );
}
