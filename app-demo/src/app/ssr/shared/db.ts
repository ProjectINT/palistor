import { readFile } from "node:fs/promises";
import path from "node:path";

// Server only: the Server Components of the /ssr routes read their rows here,
// as an app would query a database or call an API with the user's cookies.
// Client modules must not import this file (it uses node:fs).

/** Parses a JSON file under `src/app/ssr/` (for example `readJson("form", "profiles.json")`). */
export async function readJson<T>(...segments: string[]): Promise<T> {
  const file = path.join(process.cwd(), "src", "app", "ssr", ...segments);
  return JSON.parse(await readFile(file, "utf8")) as T;
}
