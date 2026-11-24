"use client";

import { useSyncExternalStore } from "react";

import { DEFAULT_TAB, isTab, type Tab } from "./tabs";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readTab(): Tab {
  const hash = window.location.hash.slice(1);
  return isTab(hash) ? hash : DEFAULT_TAB;
}

// Writing the hash pushes a history entry; its hashchange re-renders the page.
function openTab(tab: Tab) {
  window.location.hash = tab;
}

/**
 * The active tab lives in the URL hash: `/#mapping` opens that tab, a click
 * writes the hash, back/forward walk through the visited tabs. The prerendered
 * HTML knows no hash, so the server snapshot (and the hydrating render) is the
 * default tab.
 */
export function useTabRouting(): readonly [Tab, (tab: Tab) => void] {
  const tab = useSyncExternalStore(subscribe, readTab, () => DEFAULT_TAB);
  return [tab, openTab];
}
