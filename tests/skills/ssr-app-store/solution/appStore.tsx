"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useForm, usePalistor, type FieldProxyNode, type Palistor, type PalistorProxy } from "palistor";

export interface Account {
  id: string;
  name: string;
}

// Module level: the config holds no request data. Only the store is per request.
const appConfig = {
  account: {
    id: { value: "" },
    name: { value: "Guest" },
  },
};

type AppStore = Palistor<typeof appConfig>;

const AppStoreContext = createContext<AppStore | null>(null);

/**
 * Rendered by the root layout. One store per mounted provider: on the server
 * that is one per request, in the browser one for as long as the layout stays
 * mounted.
 */
export function AppStoreProvider({ account, children }: { account: Account | null; children: ReactNode }) {
  const store = usePalistor(() => ({
    config: appConfig,
    initialData: account ? { account } : undefined, // in the constructor: the server's HTML already has the name
  }));
  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>;
}

/** The app's store, for the entry of a client subtree: a component a Server Component renders. */
function useAppStore(): AppStore {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("useAppStore: <AppStoreProvider> is missing above this component");
  return store;
}

// ─── Entries: one context read each; below them the nodes are props ──────────

export function Header() {
  const form = useForm(useAppStore());
  return (
    <header>
      <AccountBadge name={form.account.name} />
    </header>
  );
}

export function SettingsView() {
  const form = useForm(useAppStore());
  return <AccountSection account={form.account} />;
}

// ─── Below an entry: each component is on the node its parent gave it ────────

function AccountBadge({ name }: { name: FieldProxyNode<string> }) {
  return <span data-testid="account-badge">{useForm(name).value}</span>;
}

function AccountSection({ account }: { account: PalistorProxy<Account> }) {
  const a = useForm(account);
  return <TextField label="Display name" field={a.name} />;
}

/** Knows neither the store nor the context: any string field of any store. */
export function TextField({ label, field }: { label: string; field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return (
    <label>
      {label}
      <input value={f.value} onChange={(event) => f.onValueChange(event.target.value)} />
    </label>
  );
}
