// The mistake: "`usePalistor` called in every component that needs the shared
// store" (skills/palistor-ssr/SKILL.md, Common Mistakes). `usePalistor` builds
// one store per component instance, whatever the config: the header and the
// settings view each get their own store. Both render the server's account,
// so the HTML and the hydration look right, but an edit in the input never
// reaches the badge, and the view's store goes away with its page.
"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useForm, usePalistor, type FieldProxyNode } from "palistor";

export interface Account {
  id: string;
  name: string;
}

const appConfig = {
  account: {
    id: { value: "" },
    name: { value: "Guest" },
  },
};

const AccountContext = createContext<Account | null>(null);

export function AppStoreProvider({ account, children }: { account: Account | null; children: ReactNode }) {
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

/** Looks like "the app's store", but every caller builds its own. */
function useAppStore() {
  const account = useContext(AccountContext);
  return usePalistor(() => ({
    config: appConfig,
    initialData: account ? { account } : undefined,
  }));
}

export function Header() {
  const form = useForm(useAppStore());
  return <span data-testid="account-badge">{useForm(form.account.name).value}</span>;
}

export function SettingsView() {
  const form = useForm(useAppStore());
  return <TextField label="Display name" field={form.account.name} />;
}

export function TextField({ label, field }: { label: string; field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return (
    <label>
      {label}
      <input value={f.value} onChange={(event) => f.onValueChange(event.target.value)} />
    </label>
  );
}
