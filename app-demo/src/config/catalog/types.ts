export type Role = "admin" | "editor" | "user";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Loaded per row by the template field's own resolver. */
  isActive?: boolean | null;
}

/** What the edit form shows on top of a list row. */
export interface UserDetails extends User {
  bio: string;
  department: string;
  phone: string;
}

/** The values of the add-user form. */
export interface NewUser {
  name: string;
  email: string;
}

export interface Product {
  id: string;
  title: string;
  price: number;
  category: string;
  inStock: boolean;
}

export interface Order {
  id: string;
  title: string;
  amount: number;
  status: string;
}

export interface ServerStatus {
  status: string;
  timestamp: number;
}

/** `store.context` of the catalog store: data the resolvers need that is not form state. */
export type CatalogContext = {
  accountId: string;
  tenant: string;
};
