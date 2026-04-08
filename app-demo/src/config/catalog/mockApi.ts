export const mockUsers = [
  { id: "u1", name: "Alice Johnson", email: "alice@example.com", role: "admin" },
  { id: "u2", name: "Bob Smith", email: "bob@example.com", role: "user" },
  { id: "u3", name: "Charlie Brown", email: "charlie@example.com", role: "editor" },
];

export const mockProducts = [
  { id: "p1", title: "Laptop Pro", price: 1299, category: "electronics", inStock: true },
  { id: "p2", title: "Wireless Mouse", price: 29, category: "electronics", inStock: true },
  { id: "p3", title: "Standing Desk", price: 499, category: "furniture", inStock: false },
  { id: "p4", title: "Monitor 4K", price: 599, category: "electronics", inStock: true },
];

export const mockUserDetails: Record<string, object> = {
  u1: { department: "Engineering", phone: "+1-555-0101" },
  u2: { department: "Product", phone: "+1-555-0102" },
  u3: { department: "Marketing", phone: "+1-555-0103" },
};

export const mockUserBios: Record<string, string> = {
  u1: "Senior developer and open source contributor with 10+ years of experience.",
  u2: "Product manager passionate about user experience and data-driven decisions.",
  u3: "Content writer specializing in technical documentation and blog posts.",
};

export function fetchUsers(): Promise<typeof mockUsers> {
  return new Promise((resolve) => setTimeout(() => resolve([...mockUsers]), 800));
}

export function fetchProducts(category?: string): Promise<typeof mockProducts> {
  return new Promise((resolve) =>
    setTimeout(() => {
      const filtered = category
        ? mockProducts.filter((p) => p.category === category)
        : [...mockProducts];
      resolve(filtered);
    }, 600),
  );
}

export function fetchUserDetails(userId: string): Promise<object> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      const details = mockUserDetails[userId];
      if (details) resolve({ ...details });
      else reject(new Error(`User ${userId} not found`));
    }, 500),
  );
}

export function fetchUserBio(userId: string): Promise<string> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      const bio = mockUserBios[userId];
      if (bio !== undefined) resolve(bio);
      else reject(new Error(`Bio for user ${userId} not found`));
    }, 700),
  );
}

export function updateUser(
  id: string,
  data: { name?: string; email?: string; role?: string },
): Promise<void> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      if (Math.random() < 0.25) {
        reject(new Error("Server error: failed to save changes"));
        return;
      }
      const user = mockUsers.find((u) => u.id === id);
      if (user) {
        if (data.name !== undefined) user.name = data.name;
        if (data.email !== undefined) user.email = data.email;
        if (data.role !== undefined) user.role = data.role;
      }
      resolve();
    }, 600),
  );
}

let userIdCounter = 100;

export function createUser(data: {
  name: string;
  email: string;
}): Promise<{ id: string; name: string; email: string; role: string }> {
  return new Promise((resolve) =>
    setTimeout(() => {
      const id = `u${++userIdCounter}`;
      const newUser = { id, name: data.name, email: data.email, role: "user" };
      mockUsers.push(newUser);
      resolve(newUser);
    }, 800),
  );
}

let failCount = 0;
export function fetchUnreliableData(): Promise<{ status: string; timestamp: number }> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      failCount++;
      if (failCount % 3 !== 0) {
        reject(new Error("Service temporarily unavailable"));
      } else {
        resolve({ status: "ok", timestamp: Date.now() });
      }
    }, 300),
  );
}
