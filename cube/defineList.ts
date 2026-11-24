import type { CubeConfig } from "./core";

interface DefineListConfig {
  template: CubeConfig;
  filter?: Record<string, unknown>;
  sort?: unknown;
  resolve?: Record<string, unknown>;
}

/**
 * Same node shape as the store's defineList: `[template, { resolve?, filter?, sort? }?]`.
 * `sort` is Cube only: the store's defineList drops it.
 */
export function defineList(config: DefineListConfig): unknown[] {
  const node: unknown[] = [config.template];
  if (config.resolve || config.filter || config.sort) {
    const listConfig: Record<string, unknown> = {};
    if (config.resolve) listConfig.resolve = config.resolve;
    if (config.filter) listConfig.filter = config.filter;
    if (config.sort) listConfig.sort = config.sort;
    node.push(listConfig);
  }
  return node;
}
