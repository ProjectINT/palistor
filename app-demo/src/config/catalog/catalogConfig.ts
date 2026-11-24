import { Palistor, defineList } from "@palistor";
import type { ListResolveContext, PalistorEntityProxy, ResolveErrorContext, TranslateFn } from "@palistor";

import {
  createUser,
  fetchOrders,
  fetchProducts,
  fetchServerStatus,
  fetchUserBio,
  fetchUserDetails,
  fetchUserStatus,
  fetchUsers,
  updateUser,
} from "./mockApi";
import type { CatalogContext, NewUser, Order, Product, Role, ServerStatus, User, UserDetails } from "./types";

/** What a resolver here reads from its `store` argument. */
type StoreArg = { readonly context: Record<string, unknown> };

const nameRule = (value: string) => (value.trim() ? undefined : "Name is required");
const emailRule = (value: string) => (!value.trim() ? "Email is required" : value.includes("@") ? undefined : "Invalid email");

/** The account the demo starts with; the Lists tab switches it with useStoreContext. */
export const initialCatalogContext: CatalogContext = { accountId: "demo-123", tenant: "acme" };

const catalogConfig = {
  // ─── Lists & Entities tab ─────────────────────────────────────────────────

  users: defineList<User>({
    template: {
      id: { value: "" },
      name: { value: "" },
      email: { value: "" },
      role: { value: "user" },
      // A field resolve: each row loads its own status on the first read of
      // isActive.value or isActive.loading. Loading the list does not start it.
      isActive: {
        value: null,
        resolve: {
          resolver: async (row: Record<string, unknown>) => fetchUserStatus(String(row.id)),
          onError: (_error: unknown, { notify }: ResolveErrorContext) => notify("Failed to check user status"),
          // A row reads a null default as "", and the default skip check takes that
          // for a status already loaded: without this the resolver never runs.
          options: { skipIfResolved: false },
        },
      },
    },
    resolve: {
      // Reading store.context.accountId makes it a dependency: switching the
      // account re-runs the resolver. `tenant` is not read, so it does not.
      resolver: async (_values: unknown, store: StoreArg) => fetchUsers(String(store.context.accountId)),
      onError: (error: unknown, { notify }: ResolveErrorContext) =>
        notify(error instanceof Error ? error.message : "Failed to load users"),
    },
  }),

  // The form behind "Add User". Its onSubmit adds the row at once under a
  // temporary id and moves it to the server id when the server answers.
  addUser: {
    // `isRequired` marks the input; `validate` words the message (it wins over "required").
    name: { value: "", label: (t: TranslateFn) => t("catalog.userName"), isRequired: true, validate: nameRule },
    email: { value: "", label: (t: TranslateFn) => t("catalog.userEmail"), isRequired: true, validate: emailRule },
    onSubmit: async (user: NewUser): Promise<void> => {
      const tempId = `_tmp_${crypto.randomUUID()}`;
      catalogStore.proxy.users.add({ ...user, id: tempId, role: "user", isActive: null });
      try {
        const saved = await createUser(user);
        catalogStore.rekey(tempId, saved.id); // the same row, now under the server id
      } catch (error) {
        catalogStore.delete(tempId); // roll back: the row leaves every list
        throw error;
      }
    },
    afterSubmit: (_result: unknown, { reset }: { reset: () => void }) => reset(),
  },

  // The edit form of one users row, bound with useForm(row, (s) => s.editUser).
  // It has fields the list template lacks, a loader and a save of its own.
  editUser: {
    // A row field validates live through `validate`; `isRequired` only marks the input.
    name: { value: "", label: (t: TranslateFn) => t("catalog.userName"), isRequired: true, validate: nameRule },
    email: { value: "", label: (t: TranslateFn) => t("catalog.userEmail"), isRequired: true, validate: emailRule },
    role: { value: "user" as Role, label: (t: TranslateFn) => t("catalog.userRole") },
    bio: {
      value: "",
      label: "Bio",
      placeholder: "Tell about yourself...",
      // A field resolve: runs for the row on the first read of bio.value or bio.loading.
      resolve: {
        resolver: async (row: Record<string, unknown>) => fetchUserBio(String(row.id)),
        onError: (_error: unknown, { notify }: ResolveErrorContext) => notify("Failed to load bio"),
      },
    },
    department: { value: "", label: "Department" },
    phone: { value: "", label: "Phone" },
    // The template resolve: once per row, when the form mounts. Its result is merged into the row.
    resolve: {
      // The id names the row to merge into (the store implementation merges by id).
      resolver: async (user: PalistorEntityProxy<User>) => ({ id: user.id, ...(await fetchUserDetails(user.id)) }),
      onError: (_error: unknown, { notify }: ResolveErrorContext) => notify("Failed to load user details"),
    },
    // A row's onSubmit gets the entity proxy, not plain values.
    onSubmit: async (user: PalistorEntityProxy<UserDetails>) => updateUser(user.id, user.values),
  },

  // Reading `categoryFilter` makes it a dependency of the products resolver.
  categoryFilter: { value: "", label: (t: TranslateFn) => t("catalog.categoryFilter") },

  products: defineList<Product>({
    template: {
      id: { value: "" },
      title: { value: "" },
      price: { value: 0 },
      category: { value: "" },
      inStock: { value: true },
    },
    resolve: {
      resolver: async (values: { categoryFilter: string }) => fetchProducts(values.categoryFilter),
      onError: (error: unknown, { notify }: ResolveErrorContext) =>
        notify(error instanceof Error ? error.message : "Failed to load products"),
    },
  }),

  // Read by the orders resolver, so it is part of the page cache's query key.
  searchQuery: {
    value: "",
    label: (t: TranslateFn) => t("catalog.search"),
    placeholder: (t: TranslateFn) => t("catalog.searchPlaceholder"),
  },

  // A paginated list: one request per page, every loaded page cached.
  orders: defineList<Order>({
    template: {
      id: { value: "" },
      title: { value: "" },
      amount: { value: 0 },
      status: { value: "" },
    },
    resolve: {
      pagination: { pageSize: 5 },
      resolver: async (values: { searchQuery: string }, _store: unknown, ctx: ListResolveContext) =>
        fetchOrders({ q: values.searchQuery, offset: ctx.page!.offset, limit: ctx.page!.pageSize }),
      onError: (error: unknown, { notify }: ResolveErrorContext) =>
        notify(error instanceof Error ? error.message : "Failed to load orders"),
    },
  }),

  // ─── Async Resolvers tab ──────────────────────────────────────────────────

  // A group that loads its values. The service fails two calls out of three:
  // the retries absorb that, and onError runs only if all of them fail.
  serverStatus: {
    status: { value: "" },
    timestamp: { value: 0 },
    resolve: {
      resolver: async (): Promise<ServerStatus> => fetchServerStatus(),
      onError: (_error: unknown, { notify }: ResolveErrorContext) => notify("Server status is unavailable"),
      options: { retry: { attempts: 3, delay: 1000 } },
    },
  },
};

export const catalogStore = new Palistor({
  config: catalogConfig,
  // Given here, the context is in place for the first resolver run (useStoreContext sets it after the first render).
  context: initialCatalogContext,
});
