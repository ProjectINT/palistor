"use client";

import { MAPPING_ROWS } from "@/config/fieldMapping";

/**
 * The rename table: how Palistor's internal names are exposed externally
 * once fieldMapping is applied.
 */
export function MappingTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-800/50">
          <tr>
            <th className="text-left font-medium text-zinc-500 dark:text-zinc-400 px-3 py-2">
              Palistor (internal)
            </th>
            <th className="w-8" />
            <th className="text-left font-medium text-zinc-500 dark:text-zinc-400 px-3 py-2">
              External (MUI / native)
            </th>
          </tr>
        </thead>
        <tbody>
          {MAPPING_ROWS.map(([internal, external]) => (
            <tr key={internal} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="px-3 py-1.5">
                <code className="text-zinc-500 dark:text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-600">
                  {internal}
                </code>
              </td>
              <td className="text-center text-zinc-400">→</td>
              <td className="px-3 py-1.5">
                <code className="text-blue-600 dark:text-blue-400 font-medium">{external}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
