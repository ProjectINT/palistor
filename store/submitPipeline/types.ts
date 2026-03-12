/** Результат выполнения submit pipeline. */
export type SubmitResult =
  | { success: true; result?: unknown }
  | { success: false; errors: Array<{ path: string; message: string }> };
