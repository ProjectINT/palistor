import type { CubeConfig } from "./core";

interface DefineListConfig {
  template: CubeConfig;
  filter?: Record<string, unknown>;
  resolve?: Record<string, unknown>;
}

/** Same node shape as the store's defineList: `[template, { resolve?, filter? }?]`. */
export function defineList(config: DefineListConfig): unknown[] {
  const node: unknown[] = [config.template];
  if (config.resolve || config.filter) {
    const listConfig: Record<string, unknown> = {};
    if (config.resolve) listConfig.resolve = config.resolve;
    if (config.filter) listConfig.filter = config.filter;
    node.push(listConfig);
  }
  return node;
}
