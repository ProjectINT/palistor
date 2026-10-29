import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Contract tests (cube/contract/**) and benches (cube/bench/**) import the
// public API from "@impl"; each project points it at one implementation.
const impl = (entry: string) => ({ "@impl": fileURLToPath(new URL(entry, import.meta.url)) });

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    projects: [
      {
        extends: true,
        resolve: { alias: impl("./index.ts") },
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
    ],
  },
});
