import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Contract tests (cube/contract/**) and benches (cube/bench/**) import the
// public API from "@impl"; each project points it at one implementation:
// "store" at the store reference entry (index.store.ts), "cube" at the Cube
// core. The package entry index.ts re-exports cube/ since Gate 2.
const impl = (entry: string) => ({ "@impl": fileURLToPath(new URL(entry, import.meta.url)) });

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    projects: [
      {
        extends: true,
        resolve: { alias: impl("./index.store.ts") },
        test: {
          name: "store",
          include: ["{store,react}/**/*.test.{ts,tsx}", "cube/contract/**/*.test.{ts,tsx}"],
          benchmark: { include: ["cube/bench/**/*.bench.{ts,tsx}"] },
        },
      },
      {
        extends: true,
        resolve: { alias: impl("./cube/index.ts") },
        test: {
          name: "cube",
          include: ["cube/**/*.test.{ts,tsx}"],
          benchmark: { include: ["cube/bench/**/*.bench.{ts,tsx}"] },
        },
      },
      // Task checks for the agent skills (skills/, tests/skills/README.md):
      // reference solutions import "palistor" like a consumer does, resolved
      // to the package entry.
      {
        extends: true,
        resolve: { alias: { palistor: fileURLToPath(new URL("./index.ts", import.meta.url)) } },
        test: {
          name: "skills",
          include: ["tests/skills/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
