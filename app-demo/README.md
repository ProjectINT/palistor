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
| `npm run test:e2e:store` | The same suite on `store`; the `/ssr` specs are skipped there |
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
