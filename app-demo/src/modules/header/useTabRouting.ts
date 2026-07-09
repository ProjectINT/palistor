"use client";

import { useCallback, useEffect, useState } from "react";

import { TABS, type TabType } from "./TabNavigation";

const DEFAULT_TAB: TabType = "form";

function hashToTab(): TabType | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  return (TABS as readonly string[]).includes(hash) ? (hash as TabType) : null;
}

/**
 * Hash-based tab routing for the demo.
 *
 * - Deep links like `/#mapping` open the matching tab on load.
 * - Clicking a tab writes the hash, so the URL is shareable.
 * - Browser back/forward move between previously visited tabs (hashchange).
 *
 * SSR / static-export safe: `window` is only touched inside the effect and
 * event handlers, never during the initial render.
 */
export function useTabRouting(): readonly [TabType, (tab: TabType) => void] {
  const [activeTab, setActiveTab] = useState<TabType>(DEFAULT_TAB);

  useEffect(() => {
    // Sync from the initial URL hash after hydration.
    setActiveTab(hashToTab() ?? DEFAULT_TAB);

    const onHashChange = () => setActiveTab(hashToTab() ?? DEFAULT_TAB);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const changeTab = useCallback((tab: TabType) => {
    setActiveTab(tab);
    if (typeof window !== "undefined" && hashToTab() !== tab) {
      // Writing the hash pushes a history entry so back/forward move between tabs.
      window.location.hash = tab;
    }
  }, []);

  return [activeTab, changeTab] as const;
}
