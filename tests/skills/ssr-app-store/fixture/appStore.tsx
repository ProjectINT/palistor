"use client";

import type { ReactNode } from "react";
import type { FieldProxyNode } from "palistor";

export interface Account {
  id: string;
  name: string;
}

// TODO: build the app-wide store described in task.md.

export function AppStoreProvider(props: { account: Account | null; children: ReactNode }) {
  return <>{props.children}</>;
}

export function Header() {
  return null;
}

export function SettingsView() {
  return null;
}

export function TextField(props: { label: string; field: FieldProxyNode<string> }) {
  return null;
}
