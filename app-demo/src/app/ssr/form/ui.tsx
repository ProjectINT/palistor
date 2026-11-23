import type { FieldProxyNode } from "@palistor";

// Small presentational pieces shared by the blocks of /ssr/form (native
// controls in the zinc palette of the other /ssr routes).

export const LABEL_CLASS = "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";

export const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100";

export function buttonClass(tone: "primary" | "neutral" | "danger"): string {
  const tones = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    neutral:
      "bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100",
    danger: "bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-950 dark:hover:bg-red-900 dark:text-red-300",
  };
  return `px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`;
}

/** A text field bound to a store leaf: its label comes from the store (translated on the server too). */
export function TextField({
  field,
  testId,
  type = "text",
  multiline = false,
}: {
  field: FieldProxyNode<string>;
  testId: string;
  type?: "text" | "email";
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{field.label}</span>
      {multiline ? (
        <textarea
          data-testid={testId}
          rows={3}
          value={field.value}
          onChange={(e) => field.onValueChange(e.target.value)}
          className={INPUT_CLASS}
        />
      ) : (
        <input
          data-testid={testId}
          type={type}
          value={field.value}
          onChange={(e) => field.onValueChange(e.target.value)}
          className={INPUT_CLASS}
        />
      )}
    </label>
  );
}

/** "name: value" for a piece of node state (`dirty`, `loading`, `resolveStatus`). */
export function Flag({ name, value, testId }: { name: string; value: boolean | string; testId: string }) {
  const busy = value === "pending" || (name === "loading" && value === true);
  const alert = !busy && (value === true || value === "error");
  const tone = alert
    ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
    : busy
      ? "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800"
      : "bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-xs ${tone}`}>
      {name}: <span data-testid={testId}>{String(value)}</span>
    </span>
  );
}
