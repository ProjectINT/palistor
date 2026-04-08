import { Palistor } from "@palistor/store/store";
import { useForm } from "@palistor/react/useForm";
import type { TranslateFn } from "@palistor";
import { fetchUsers, fetchProducts, fetchUnreliableData, fetchUserDetails, fetchUserBio } from "./mockApi";

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

  // --- Users list (ListNode: [template, listConfig]) ---
  users: [
    {
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
    },
    {
      resolve: {
        resolver: async () => {
          const users = await fetchUsers();
          return users;
        },
      },
    },
  ],

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

  // --- Entity editing template ---
  editUser: {
    nested: true,
    resolve: {
      resolver: async (entityProxy: any) => {
        return await fetchUserDetails(entityProxy.id);
      },
      onError: (err: Error, { notify }: any) => notify?.("Failed to load user details"),
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
