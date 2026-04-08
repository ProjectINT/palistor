export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface CatalogValues {
  categoryFilter: string;
  searchQuery: string;
  users: Array<{ id: string; name: string; email: string; role: string }>;
  products: Array<{
    id: string;
    title: string;
    price: number;
    category: string;
    inStock: boolean;
  }>;
  serverStatus: {
    status: string;
    timestamp: number;
  };
  editUser: {
    name: string;
    email: string;
    role: string;
    bio: string;
    department: string;
    phone: string;
  };
}
