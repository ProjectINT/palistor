# Task: one app-wide store in a server-rendered app

Our Next.js app (App Router) keeps its state in `palistor`. We need one store for the whole app: it holds the signed-in account, and the header and every page read the same state. Build it in `appStore.tsx`, a Client Component module.

The root layout is a Server Component. It already loads the account of the current request on the server (`null` for a signed-out visitor) and renders:

```tsx
<AppStoreProvider account={account}>
  <Header />
  <main>{children}</main>
</AppStoreProvider>
```

The settings page, a Server Component too, renders `<SettingsView />` inside `{children}`.

Export from `appStore.tsx`:

- `AppStoreProvider` — props `{ account: Account | null; children: ReactNode }`
- `Header` — no props. Shows the account's display name inside an element with `data-testid="account-badge"`. A signed-out visitor sees `Guest`.
- `SettingsView` — no props. Shows a text input labelled `Display name` that edits the account's display name. It renders the input with `TextField`.
- `TextField` — our shared text input, props as declared in the file: a text input labelled `label` that edits the field it is given. Other screens use it for fields of their own stores.

Behavior:

1. The page arrives ready. The HTML rendered on the server already has the account's name in the badge and in the input.
2. In the browser the page hydrates without a hydration warning.
3. The state is shared. Typing in the input changes the badge in the header at once.
4. The state lives as long as the layout. When the user navigates to another page and comes back (the layout stays mounted, only the page inside it changes), the input and the badge still show what was typed.
5. Requests never share state. The HTML for a signed-out visitor, rendered by the same server process right after a signed-in user's page, shows `Guest` and nothing of that user.
6. `TextField` works on any field. Given a field of another store, outside `AppStoreProvider`, it shows and edits that field.
