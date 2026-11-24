# Palistor demo

The playground of [palistor](../README.md): a Next.js app where every feature of the library runs in a
real UI. It is deployed from `main` to <https://projectint.github.io/palistor/>.

The app takes the library from the repository source through tsconfig paths (`@palistor` →
`../index.ts`), not from npm, so a change to the library shows up here on reload.

## Run it

```bash
npm ci            # in the repository root: the library's own dependencies
cd app-demo
npm ci
npm run dev       # http://localhost:3001/palistor/
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3001, on the Cube core (the package entry) |
| `npm run dev:store` | Dev server on :3002, on the legacy `store` implementation (`PALISTOR_IMPL=store`, `tsconfig.store.json`) |
| `npm run test:e2e` | Playwright suite (`e2e/`) on Cube; starts the dev server if none runs |
| `npm run test:e2e:store` | The same suite on `store`; the `/ssr` and `/lists` specs are skipped there |
| `npm run build` | Static export to `out/` (`basePath: /palistor`), as GitHub Pages serves it |
| `npm run lint` | ESLint over the app and the specs |

## What is where

The home page is a set of tabs, each addressable by hash (`/#lists`):

| Tab | Shows | Config | Components |
| --- | --- | --- | --- |
| Payment Form (`#form`) | Visibility, required and validation rules, formatters, setters, computed fields, a nested group with its own submit, persistence | [`src/config/appConfig.ts`](src/config/appConfig.ts) and the section files next to it | [`src/modules/payment-form/`](src/modules/payment-form) |
| Flow Wizard (`#flow`) | `defineFlow` / `defineStep`, a branch that appears for one plan | [`src/config/flow.ts`](src/config/flow.ts) | [`src/modules/flow-demo/`](src/modules/flow-demo) |
| Lists & Entities (`#lists`) | `defineList`, row editing through a template, optimistic add, pagination, store context | [`src/config/catalog/`](src/config/catalog) | [`src/modules/lists-demo/`](src/modules/lists-demo) |
| Async Resolvers (`#async`) | `resolve` on lists and groups: loading, retry, dependencies tracked automatically | [`src/config/catalog/`](src/config/catalog) | [`src/modules/async-demo/`](src/modules/async-demo) |
| User Profile (`#hooks`) | One field per component: `useForm(field)` and the re-render it isolates | [`src/config/appConfig.ts`](src/config/appConfig.ts) | [`src/modules/hooks-demo/`](src/modules/hooks-demo) |
| Field Mapping (`#mapping`) | A config written in a UI kit's prop names, spread into an input that knows nothing about Palistor | [`src/config/fieldMapping.ts`](src/config/fieldMapping.ts) | [`src/modules/field-mapping/`](src/modules/field-mapping) |
| Debug Panel (`#debug`) | Form flags and list sizes across stores | — | [`src/modules/debug-panel/`](src/modules/debug-panel) |

The side panel ([`src/modules/state-preview/`](src/modules/state-preview)) prints the values of the store the
active tab works on.

The `/ssr` routes ([`src/app/ssr/`](src/app/ssr)) render on the server in the App Router: `/ssr`, `/ssr/form`,
`/ssr/catalog`, `/ssr/flow`, `/ssr/runtime`. Each is a Server Component (`page.cube.tsx`) that loads its data
and hands it to a client view that builds its store with `usePalistor`. They need the Cube core: on
`store` the `.cube.tsx` extension is not a page extension, so the routes do not exist there
([`next.config.ts`](next.config.ts)).

The `/lists` routes ([`src/app/lists/`](src/app/lists)) show the list features one page each, built the same
way as `/ssr` (a `page.cube.tsx` Server Component, a client view with `usePalistor`, Cube only; the Lists
tab links to them on Cube):

| Route | Shows | View |
| --- | --- | --- |
| `/lists` | Products: one load, then a client-side sort (`sort: true`, a header per column through `useForm(list.sort)`: ascending / descending / server order, `aria-sort`, an order snapshot that "Re-sort" — `sort.refresh()` — takes again after an edit or an add) and a filter block of client fields only (`where`, `$all` over a price range, a derived field), chips with `clear(field)`, `reset()`, a `set()` preset, `isActive` / `activeCount`, "N of M" from `fullLength`, inline price edit and a local add; Favorites: the same entities in a second list (`add(id)`, `setItems` reorder, `dirty`, `reload()` to restore the saved membership) | [`ProductsView.tsx`](src/app/lists/ProductsView.tsx), [`productsConfig.ts`](src/app/lists/productsConfig.ts) |
| `/lists/orders` | Orders: a paginated server list in a HeroUI `Table`; server sort on the column headers (`sort` block with `$default` and `param`, `ctx.sort`, the table's `sortDescriptor` / `onSortChange`); a server filter with a debounced search and a status, renamed for the request by `param`, with `filter.isPending`; `prefetch` on hovering Next, `setPageSize`, Refresh page (`invalidate(page)`), `keepPreviousData` (`isPreviousData`), `maxCachedQueries: 3`, `staleTime` | [`orders/OrdersView.tsx`](src/app/lists/orders/OrdersView.tsx) |
| `/lists/customers` | Customers: a paginated server list with a filter in "Apply" mode (`$apply: "manual"`: a draft panel, Apply / Cancel, a badge and chips of the applied filters), a debounced quick search that applies itself, the request built by `$toParams`; each account's invoices as a list nested in the row, paginated per row | [`customers/CustomersView.tsx`](src/app/lists/customers/CustomersView.tsx) |
| `/lists/feeds` | Feed: an `infinite` list with Load more, the end through `nextCursor: null`, `maxPages`, a server sort Newest / Oldest (`sort: { $default: "-createdAt" }`, `ctx.sort`; a change is one request and starts the window over at page 1), and its window and scroll anchor saved with `usePersist` (`persist: "window"`, `setScrollAnchor`; the sort is not saved, so a window saved under Oldest is not reused); Journal: `cursor` mode, Back from the cache, `suspense: true` under `<Suspense>`. One store per block | [`feeds/FeedsView.tsx`](src/app/lists/feeds/FeedsView.tsx), [`feeds/feedsConfig.ts`](src/app/lists/feeds/feedsConfig.ts) |

The shared frame (title, nav, locale switch) is [`src/app/lists/shared/ListsShell.tsx`](src/app/lists/shared/ListsShell.tsx);
the specs are `e2e/lists-*.spec.ts` (`e2e/lists.spec.ts` covers the Lists tab) and skip themselves on `store`.

## How the components connect to a store

The code follows the same rule everywhere, so any tab can serve as a template:

- **One root per view.** A store is created once, at module level in `src/config/` (in `/ssr`: per request,
  with `usePalistor`). The component at the top of a tab is the only one that imports it and calls
  `useForm(store)`.
- **Nodes go down as props.** The root hands each child the node it renders: a group, a list, a row, a
  flow, a step or a single field. The child calls `useForm(props.node)` and does the same for its
  own children. A component that only hands nodes down reads no state and does not re-render when
  something below it changes.
- **One adapter per input kind.** [`src/components/`](src/components) holds `TextField`, `SelectField` and
  `CheckboxField` (HeroUI). Each takes `field={…}`, calls `useForm` on it and maps the field's state
  to the input's props, so an edit re-renders only that input.
- **Rules live in the config.** Visibility, requiredness, validation, cascades and computed values are
  config keys. Components keep no form state in `useState` or `useEffect`, and they write through
  `onValueChange`, `setValues`, `submit` or `reset`.

The agent skills shipped with the package ([`../skills/`](../skills)) describe the same patterns.
