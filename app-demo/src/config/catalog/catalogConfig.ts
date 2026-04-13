import { Palistor } from "@palistor/store/store";
import { useForm } from "@palistor/react/useForm";
import { defineList } from "@palistor/store/defineList";
import type { TranslateFn } from "@palistor";
import { fetchUsers, fetchProducts, fetchUnreliableData, fetchUserDetails, fetchUserBio, fetchUserStatus, updateUser, createUser } from "./mockApi";
import type { User } from "./types";

export const catalogFormConfig = {
  // --- Filter fields ---
  categoryFilter: {
    value: "",
    label: (t: TranslateFn) => t("catalog.categoryFilter"),
    placeholder: (t: TranslateFn) => t("catalog.categoryFilterPlaceholder"),
  },

  searchQuery: {
    value: "",
    label: (t: TranslateFn) => t("catalog.search"),
    placeholder: (t: TranslateFn) => t("catalog.searchPlaceholder"),
  },

  // --- Refresh trigger for users list (increment to force re-resolve) ---
  usersRefreshKey: { value: 0 },

  // --- Users list (defineList<User> — preferred typed API) ---
  users: defineList<User>({
    template: {
      id: { value: "" },
      name: {
        value: "",
        label: (t: TranslateFn) => t("catalog.userName"),
      },
      email: {
        value: "",
        label: (t: TranslateFn) => t("catalog.userEmail"),
        validate: (v: string) => (v && !v.includes("@") ? "Invalid email" : undefined),
      },
      role: {
        value: "",
        label: (t: TranslateFn) => t("catalog.userRole"),
      },
      // Template field with its own per-entity resolver.
      // After the list resolver returns all users, Palistor automatically triggers
      // fetchUserStatus for EACH entity independently.
      // Also triggers lazily on first access to isActive.value / isActive.loading.
      isActive: {
        value: null as boolean | null,
        resolve: {
          resolver: async (entityValues: Record<string, unknown>) => {
            return await fetchUserStatus(entityValues.id as string);
          },
          onError: (_err: unknown, { notify }: { notify: (msg: string) => void }) =>
            notify("Failed to check user status"),
          options: {
            skipIfResolved: false, // always re-check — status can change
          },
        },
      },
    },
    resolve: {
      resolver: async (values: Record<string, unknown>, store: any) => {
        // Read usersRefreshKey to register it as an auto-dep:
        // incrementing it from the UI will re-trigger this resolver
        void values.usersRefreshKey;
        const accountId = store?.context?.accountId as string | undefined;
        const users = await fetchUsers(accountId);
        return users;
      },
      onError: (err: unknown, { notify }: { notify: (msg: string) => void }) =>
        notify(err instanceof Error ? err.message : "Failed to load users"),
    },
  }),

  // --- Products list (ListNode with auto-deps on categoryFilter) ---
  products: [
    {
      id: { value: "" },
      title: {
        value: "",
        label: (t: TranslateFn) => t("catalog.productTitle"),
      },
      price: {
        value: 0,
        label: (t: TranslateFn) => t("catalog.productPrice"),
      },
      category: { value: "" },
      inStock: { value: true },
    },
    {
      resolve: {
        resolver: async (values: Record<string, unknown>) => {
          const category = (values.categoryFilter as string) || undefined;
          const products = await fetchProducts(category);
          return products;
        },
      },
    },
  ],

  // --- Group with resolve (async single-object load) ---
  serverStatus: {
    nested: true,
    resolve: {
      resolver: async () => {
        const data = await fetchUnreliableData();
        return data;
      },
      options: {
        retry: { attempts: 3, delay: 1000 },
      },
    },
    status: {
      value: "",
      label: "Server Status",
    },
    timestamp: {
      value: 0,
      label: "Last Check",
    },
  },

  // --- Add user form ---
  addUser: {
    nested: true,
    name: {
      value: "",
      label: (t: TranslateFn) => t("catalog.userName"),
      isRequired: true,
      validate: (v: string) => (!v.trim() ? "Name is required" : undefined),
    },
    email: {
      value: "",
      label: (t: TranslateFn) => t("catalog.userEmail"),
      isRequired: true,
      validate: (v: string) => (v && !v.includes("@") ? "Invalid email" : undefined),
    },
    onSubmit: async (formValues: Record<string, unknown>, store: any) => {
      const tempId = `_tmp_${Date.now()}`;
      const name = formValues.name as string;
      const email = formValues.email as string;
      store.proxy.users.add({ id: tempId, name, email, role: "user" });
      try {
        const saved = await createUser({ name, email });
        store.rekey(tempId, saved.id);
      } catch (e) {
        store.proxy.users.remove(tempId);
        store.delete(tempId);
        throw e;
      }
    },
    afterSubmit: (_result: unknown, { reset }: { reset: () => void }) => {
      reset();
    },
  },

  // --- Entity editing template ---
  editUser: {
    nested: true,
    resolve: {
      resolver: async (entityProxy: any) => {
        const details = await fetchUserDetails(entityProxy.id);
        return { id: entityProxy.id, ...details };
      },
      onError: (err: Error, { notify }: any) => notify?.("Failed to load user details"),
    },
    onSubmit: async (formValues: Record<string, unknown>) => {
      await updateUser(formValues.id as string, formValues as { name?: string; email?: string; role?: string });
    },
    afterSubmit: (_result: unknown, _actions: { reset: () => void }) => {
      // Success feedback is handled by the UI component
    },
    name: {
      value: "",
      label: (t: TranslateFn) => t("catalog.userName"),
      isRequired: true,
      validate: (v: string) => (!v ? "Name is required" : undefined),
    },
    email: {
      value: "",
      label: (t: TranslateFn) => t("catalog.userEmail"),
      isRequired: true,
      validate: (v: string) => (v && !v.includes("@") ? "Invalid email" : undefined),
    },
    role: {
      value: "",
      label: (t: TranslateFn) => t("catalog.userRole"),
    },
    bio: {
      value: "",
      label: "Bio",
      placeholder: "Tell about yourself...",
      resolve: {
        resolver: async (entityValues: any) => {
          return await fetchUserBio(entityValues.id);
        },
        onError: (err: Error, { notify }: any) => {
          console.log('err', err);
          notify?.("Failed to load bio");
        },
        options: { skipIfResolved: true },
      },
    },
    department: {
      value: "",
      label: "Department",
    },
    phone: {
      value: "",
      label: "Phone",
    },
  },
};

export const catalogStore = new Palistor({
  config: catalogFormConfig,
});

export const useCatalogForm = () => useForm(catalogStore) as any;
