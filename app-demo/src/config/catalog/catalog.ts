import type { TranslateFn } from "@palistor";
import { fetchUsers, fetchProducts, fetchUnreliableData } from "./mockApi";

export const catalog = {
  // --------------------------------------------------------------------------
  // Catalog filters
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Lists — demonstrates ListNode ([template, listConfig])
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // A group with an async resolve — demonstrates the retry strategy
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Entity editing — demonstrates a nested group
  // --------------------------------------------------------------------------
  editUser: {
    nested: true,
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
