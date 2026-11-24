// A fake backend for the catalog store: every call answers after a delay.

import type { NewUser, Order, Product, ServerStatus, User, UserDetails } from "./types";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Users ───────────────────────────────────────────────────────────────────

const users: User[] = [
  { id: "u1", name: "Alice Johnson", email: "alice@example.com", role: "admin" },
  { id: "u2", name: "Bob Smith", email: "bob@example.com", role: "user" },
  { id: "u3", name: "Charlie Brown", email: "charlie@example.com", role: "editor" },
];

/** Each user's status answers after its own delay: the rows resolve one by one. */
const statuses: Record<string, { isActive: boolean; delay: number }> = {
  u1: { isActive: true, delay: 400 },
  u2: { isActive: false, delay: 700 },
  u3: { isActive: true, delay: 250 },
};

const details: Record<string, Pick<UserDetails, "department" | "phone">> = {
  u1: { department: "Engineering", phone: "+1-555-0101" },
  u2: { department: "Product", phone: "+1-555-0102" },
  u3: { department: "Marketing", phone: "+1-555-0103" },
};

const bios: Record<string, string> = {
  u1: "Senior developer and open source contributor with 10+ years of experience.",
  u2: "Product manager passionate about user experience and data-driven decisions.",
  u3: "Content writer specializing in technical documentation and blog posts.",
};

/** A real API would scope the users by the account. */
export async function fetchUsers(accountId: string): Promise<User[]> {
  void accountId;
  await delay(800);
  return users.map((user) => ({ ...user }));
}

export async function fetchUserStatus(userId: string): Promise<boolean> {
  const entry = statuses[userId];
  await delay(entry?.delay ?? 500);
  return entry?.isActive ?? false;
}

export async function fetchUserDetails(userId: string): Promise<Pick<UserDetails, "department" | "phone">> {
  await delay(500);
  const found = details[userId];
  if (!found) throw new Error(`User ${userId} not found`);
  return { ...found };
}

export async function fetchUserBio(userId: string): Promise<string> {
  await delay(700);
  const bio = bios[userId];
  if (bio === undefined) throw new Error(`Bio for user ${userId} not found`);
  return bio;
}

/** Takes the request body as it would arrive. Fails one call in four, so the edit form has an error to show. */
export async function updateUser(id: string, body: Record<string, unknown>): Promise<void> {
  await delay(600);
  if (Math.random() < 0.25) throw new Error("Server error: failed to save changes");
  const user = users.find((u) => u.id === id);
  if (user) Object.assign(user, { name: body.name, email: body.email, role: body.role });
}

let lastUserId = 100;

export async function createUser(data: NewUser): Promise<User> {
  await delay(800);
  const user: User = { id: `u${++lastUserId}`, name: data.name, email: data.email, role: "user" };
  users.push(user);
  return { ...user };
}

// ─── Products ────────────────────────────────────────────────────────────────

const products: Product[] = [
  { id: "p1", title: "Laptop Pro", price: 1299, category: "electronics", inStock: true },
  { id: "p2", title: "Wireless Mouse", price: 29, category: "electronics", inStock: true },
  { id: "p3", title: "Standing Desk", price: 499, category: "furniture", inStock: false },
  { id: "p4", title: "Monitor 4K", price: 599, category: "electronics", inStock: true },
];

/** An empty category returns every product. */
export async function fetchProducts(category: string): Promise<Product[]> {
  await delay(600);
  return products.filter((p) => !category || p.category === category).map((p) => ({ ...p }));
}

// ─── Orders: a paginated endpoint (57 rows) ──────────────────────────────────

const ORDER_STATUSES = ["paid", "pending", "shipped", "cancelled"];

const orders: Order[] = Array.from({ length: 57 }, (_, i) => ({
  id: `ord-${i + 1}`,
  title: `Order #${1000 + i}`,
  amount: ((i * 37) % 900) + 25,
  status: ORDER_STATUSES[i % ORDER_STATUSES.length],
}));

/** LIMIT/OFFSET over the matching orders, with the total: the shape a paginated resolver returns. */
export async function fetchOrders(params: { q: string; offset: number; limit: number }): Promise<{ items: Order[]; total: number }> {
  await delay(500);
  const q = params.q.trim().toLowerCase();
  const rows = q ? orders.filter((o) => o.title.toLowerCase().includes(q) || o.status.includes(q)) : orders;
  return { items: rows.slice(params.offset, params.offset + params.limit), total: rows.length };
}

// ─── Server status: fails two calls out of three ─────────────────────────────

let statusCalls = 0;

export async function fetchServerStatus(): Promise<ServerStatus> {
  await delay(300);
  statusCalls++;
  if (statusCalls % 3 !== 0) throw new Error("Service temporarily unavailable");
  return { status: "ok", timestamp: Date.now() };
}
