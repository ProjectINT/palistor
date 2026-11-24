/** The demo's tabs, in display order. Each one is addressable as `/#<tab>`. */
export const TABS = ["form", "flow", "lists", "async", "hooks", "mapping", "debug"] as const;

export type Tab = (typeof TABS)[number];

export const DEFAULT_TAB: Tab = "form";

/** Message keys of the tab buttons. */
export const TAB_LABELS: Record<Tab, string> = {
  form: "demo.tabs.payment",
  flow: "demo.tabs.flow",
  lists: "demo.tabs.lists",
  async: "demo.tabs.async",
  hooks: "demo.tabs.user",
  mapping: "demo.tabs.mapping",
  debug: "demo.tabs.debug",
};

export function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value);
}
