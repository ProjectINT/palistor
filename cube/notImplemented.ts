/** Thrown by every part of the public surface that Cube doesn't cover yet. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`palistor/cube: ${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

export function notImplemented(what: string): never {
  throw new NotImplementedError(what);
}

/** Placeholder for a public function export: same name, throws when called. */
export const stub = (what: string) => (..._args: unknown[]): never => notImplemented(what);
