# Plan: Новые демо-табы для Palistor

## Контекст

Текущее демо-приложение показывает только базовые возможности Palistor (формы, валидация, computed, nested fields, i18n, persist). Не продемонстрированы ключевые новые возможности: **списки (ListNode)**, **асинхронные резольверы**, **Entity Registry**, **Entity Projection**, **loading-состояния**, **CRUD через store.set/delete/rekey**.

Нужно добавить **2 новые табы** + **новый store** (или расширить существующий) для демонстрации.

---

## Архитектура изменений

### Новый store: `catalogStore`

Отдельный `Palistor` с конфигом, демонстрирующим списки и резольверы. Тема: **каталог продуктов с пользователями** — бессмысленная, но показывает все фичи.

### Новые табы

| Таб | Что демонстрирует |
|-----|-------------------|
| **"Lists & Entities"** | ListNode, Entity CRUD, списки с add/remove, entity projection, dirty списков |
| **"Async Resolvers"** | Асинхронная загрузка данных, loading states, error handling, retry, auto-deps |

---

## Итерация 1: Инфраструктура + конфиг нового store

### 1.1 Создать mock API (`app-demo/src/config/catalog/mockApi.ts`)

Статические данные + промисы с задержкой, эмулирующие API:

```ts
// Список пользователей
export const mockUsers = [
  { id: "u1", name: "Alice Johnson", email: "alice@example.com", role: "admin" },
  { id: "u2", name: "Bob Smith", email: "bob@example.com", role: "user" },
  { id: "u3", name: "Charlie Brown", email: "charlie@example.com", role: "editor" },
];

// Список продуктов
export const mockProducts = [
  { id: "p1", title: "Laptop Pro", price: 1299, category: "electronics", inStock: true },
  { id: "p2", title: "Wireless Mouse", price: 29, category: "electronics", inStock: true },
  { id: "p3", title: "Standing Desk", price: 499, category: "furniture", inStock: false },
  { id: "p4", title: "Monitor 4K", price: 599, category: "electronics", inStock: true },
];

// Детали пользователя (загружается при открытии)
export const mockUserDetails: Record<string, object> = {
  u1: { bio: "Senior developer", department: "Engineering", phone: "+1-555-0101" },
  u2: { bio: "Product manager", department: "Product", phone: "+1-555-0102" },
  u3: { bio: "Content writer", department: "Marketing", phone: "+1-555-0103" },
};

// Mock API функции
export function fetchUsers(): Promise<typeof mockUsers> {
  return new Promise((resolve) => setTimeout(() => resolve([...mockUsers]), 800));
}

export function fetchProducts(category?: string): Promise<typeof mockProducts> {
  return new Promise((resolve) => setTimeout(() => {
    const filtered = category 
      ? mockProducts.filter(p => p.category === category)
      : [...mockProducts];
    resolve(filtered);
  }, 600));
}

export function fetchUserDetails(userId: string): Promise<object> {
  return new Promise((resolve, reject) => setTimeout(() => {
    const details = mockUserDetails[userId];
    if (details) resolve({ ...details });
    else reject(new Error(`User ${userId} not found`));
  }, 500));
}

// Для демо ошибок — фейлящийся endpoint
let failCount = 0;
export function fetchUnreliableData(): Promise<{ status: string }> {
  return new Promise((resolve, reject) => setTimeout(() => {
    failCount++;
    if (failCount % 3 !== 0) {
      reject(new Error("Service temporarily unavailable"));
    } else {
      resolve({ status: "ok", timestamp: Date.now() });
    }
  }, 300));
}
```

### 1.2 Создать типы (`app-demo/src/config/catalog/types.ts`)

```ts
export interface CatalogValues {
  // Фильтр
  categoryFilter: string;
  searchQuery: string;
  
  // Списки (ListNode — массивы в конфиге)
  users: Array<{ id: string; name: string; email: string; role: string }>;
  products: Array<{ id: string; title: string; price: number; category: string; inStock: boolean }>;
  
  // Группа с resolve (асинхронная загрузка)
  serverStatus: {
    status: string;
    timestamp: number;
  };
  
  // Поля для entity editing template
  editUser: {
    name: string;
    email: string;
    role: string;
    bio: string;
    department: string;
    phone: string;
  };
}
```

### 1.3 Создать конфиг каталога (`app-demo/src/config/catalog/catalogConfig.ts`)

Конфиг Palistor с ListNode и resolve:

```ts
import { Palistor } from "@palistor/store/store";
import { useForm } from "@palistor/react/useForm";
import type { FormConfig, TranslateFn } from "@palistor";
import { fetchUsers, fetchProducts, fetchUnreliableData } from "./mockApi";
import type { CatalogValues } from "./types";

export const catalogFormConfig = {
  // --- Фильтр категорий (обычное поле) ---
  categoryFilter: {
    value: "",
    label: (t: TranslateFn) => t("catalog.categoryFilter"),
    placeholder: (t: TranslateFn) => t("catalog.categoryFilterPlaceholder"),
    types: { dataType: "String" as const, type: "string" },
  },

  searchQuery: {
    value: "",
    label: (t: TranslateFn) => t("catalog.search"),
    placeholder: (t: TranslateFn) => t("catalog.searchPlaceholder"),
    types: { dataType: "String" as const, type: "string" },
  },

  // --- СПИСОК ПОЛЬЗОВАТЕЛЕЙ (ListNode с resolve) ---
  // Массив длины 2: [template, listConfig]
  users: [
    // template — описывает поля одного элемента списка
    {
      id: { value: "" },
      name: { 
        value: "",
        label: (t: TranslateFn) => t("catalog.userName"),
      },
      email: { 
        value: "",
        label: (t: TranslateFn) => t("catalog.userEmail"),
        validate: (v: string) => v.includes("@") ? undefined : "Invalid email",
      },
      role: { 
        value: "",
        label: (t: TranslateFn) => t("catalog.userRole"),
      },
    },
    // listConfig — resolve для загрузки данных
    {
      resolve: {
        resolver: async () => {
          const users = await fetchUsers();
          return users; // Массив → upsert entities + заполнить itemIds
        },
      },
    },
  ],

  // --- СПИСОК ПРОДУКТОВ (ListNode с resolve + deps) ---
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
        resolver: async (values: any) => {
          // Авто-зависимость: читает categoryFilter → retrigger при изменении
          const category = values.categoryFilter || undefined;
          const products = await fetchProducts(category);
          return products;
        },
        // deps: ["categoryFilter"], // Можно явно, но авто-deps тоже работают
      },
    },
  ],

  // --- ГРУППА С RESOLVE (асинхронная загрузка одного объекта) ---
  serverStatus: {
    nested: true,
    resolve: {
      resolver: async () => {
        const data = await fetchUnreliableData();
        return data;
      },
      onError: (error: Error, ctx: any) => {
        ctx.notify?.({ type: "error", message: error.message });
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

  // --- TEMPLATE для entity editing ---
  // Этот шаблон используется при useForm(entity, (s) => s.editUser)
  editUser: {
    nested: true,
    isVisible: false, // Скрываем из основной формы — это шаблон
    resolve: {
      resolver: async (thisForm: any, store: any) => {
        // thisForm — это entity values (proxy)
        const userId = thisForm.id;
        if (!userId) return {};
        const { fetchUserDetails } = await import("./mockApi");
        const details = await fetchUserDetails(userId);
        return details; // Будет слито в entity через applyPatch
      },
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
      validate: (v: string) => (v.includes("@") ? undefined : "Invalid email"),
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
      formatter: (v: string) => v.replace(/[^\d+\-() ]/g, ""),
    },
  },
} satisfies FormConfig<CatalogValues>;

export const catalogDefaults: CatalogValues = {
  categoryFilter: "",
  searchQuery: "",
  users: [],
  products: [],
  serverStatus: { status: "", timestamp: 0 },
  editUser: { name: "", email: "", role: "", bio: "", department: "", phone: "" },
};

export const catalogStore = new Palistor({
  config: catalogFormConfig,
  initialValues: catalogDefaults,
});

export const useCatalogForm = () => useForm(catalogStore) as any;
```

### 1.4 Обновить TabNavigation

Файл: `app-demo/src/modules/header/TabNavigation.tsx`

Добавить новые табы:

```ts
export type TabType = "form" | "hooks" | "debug" | "lists" | "async";

const TABS: TabType[] = ["form", "lists", "async", "hooks", "debug"];

const TAB_LABELS: Record<TabType, string> = {
  form: "demo.tabs.payment",
  lists: "demo.tabs.lists",
  async: "demo.tabs.async",
  hooks: "demo.tabs.user",
  debug: "demo.tabs.debug",
};
```

### 1.5 Обновить page.tsx

Добавить рендеринг новых табов + подключить `catalogStore`:

```tsx
import { catalogStore } from "@/config/catalog/catalogConfig";
// ...
useTranslator(catalogStore, t);

// В рендере:
{activeTab === "lists" && <ListsDemo />}
{activeTab === "async" && <AsyncDemo />}
```

### 1.6 Добавить переводы в en.json и ru.json

Ключи для нового функционала:

```json
{
  "demo": {
    "tabs": {
      "lists": "Lists & Entities",
      "async": "Async Resolvers"
    }
  },
  "catalog": {
    "categoryFilter": "Category Filter",
    "categoryFilterPlaceholder": "All categories",
    "search": "Search",
    "searchPlaceholder": "Search...",
    "userName": "Name",
    "userEmail": "Email",
    "userRole": "Role",
    "productTitle": "Product",
    "productPrice": "Price",
    "users": "Users",
    "products": "Products",
    "addUser": "Add User",
    "removeUser": "Remove",
    "editUser": "Edit",
    "noUsers": "No users loaded",
    "noProducts": "No products",
    "loadingUsers": "Loading users...",
    "loadingProducts": "Loading products...",
    "serverStatus": "Server Status",
    "retry": "Retry",
    "listDirty": "List modified",
    "entityCount": "Entities: {count}"
  },
  "async": {
    "title": "Async Resolvers Demo",
    "subtitle": "Demonstrates loading states, error handling, retry, and auto-dependencies",
    "resolverStatus": "Resolver Status",
    "autoRetry": "Auto-retry on Error",
    "loadingState": "Loading...",
    "errorState": "Error occurred",
    "resolvedState": "Data loaded",
    "autoDeps": "Auto-dependencies",
    "autoDepsDescription": "Products list re-fetches when category filter changes"
  }
}
```

---

## Итерация 2: Таб "Lists & Entities"

### 2.1 Создать модуль `app-demo/src/modules/lists-demo/`

**Структура:**
```
lists-demo/
  index.ts
  ListsDemo.tsx          — корневой компонент таба
  UsersListSection.tsx   — демо списка пользователей
  ProductsListSection.tsx — демо списка продуктов с фильтром
  UserCard.tsx           — карточка пользователя в списке
  ProductRow.tsx         — строка продукта
  AddUserForm.tsx        — форма добавления пользователя
  EntityEditModal.tsx    — модальное окно редактирования entity (entity projection demo)
  ListStatsPanel.tsx     — панель со статистикой списков (dirty, length, loading)
```

### 2.2 Компонент `ListsDemo.tsx`

Главный компонент таба:
```tsx
"use client";

import { useTranslations } from "next-intl";
import { UsersListSection } from "./UsersListSection";
import { ProductsListSection } from "./ProductsListSection";
import { ListStatsPanel } from "./ListStatsPanel";

export function ListsDemo() {
  const t = useTranslations();
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-xl font-semibold mb-4">{t("catalog.users")}</h2>
        <UsersListSection />
      </div>
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-xl font-semibold mb-4">{t("catalog.products")}</h2>
        <ProductsListSection />
      </div>
      <ListStatsPanel />
    </div>
  );
}
```

### 2.3 Компонент `UsersListSection.tsx`

Демонстрирует:
- **list.items** — итерация по сущностям
- **list.map()** — React-рендер
- **list.loading** — состояние загрузки
- **list.add()** — добавление
- **list.remove()** — удаление
- **list.dirty** — отслеживание изменений
- **list.length** — количество элементов

```tsx
"use client";

import { useState } from "react";
import { useCatalogForm } from "@/config/catalog/catalogConfig";
import { UserCard } from "./UserCard";
import { AddUserForm } from "./AddUserForm";
import { EntityEditModal } from "./EntityEditModal";
import { Button } from "@/components/Button";

export function UsersListSection() {
  const form = useCatalogForm();
  const [editingId, setEditingId] = useState<string | null>(null);

  const users = form.users; // ListProxy

  if (users.loading) {
    return <div className="animate-pulse">Loading users...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Статус списка */}
      <div className="flex items-center gap-4 text-sm text-zinc-500">
        <span>Count: {users.length}</span>
        {users.dirty && <span className="text-amber-500">● Modified</span>}
      </div>

      {/* Список пользователей через list.map() */}
      <div className="space-y-2">
        {users.map((user, index, id) => (
          <UserCard
            key={id}
            user={user}
            onEdit={() => setEditingId(id)}
            onRemove={() => users.remove(id)}
          />
        ))}
      </div>

      {users.length === 0 && (
        <p className="text-zinc-400 text-center py-4">No users</p>
      )}

      {/* Добавление */}
      <AddUserForm onAdd={(data) => users.add(data)} />

      {/* Модальное окно редактирования entity */}
      {editingId && (
        <EntityEditModal
          entityId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
```

### 2.4 Компонент `UserCard.tsx`

Карточка пользователя — читает поля entity projection proxy:

```tsx
"use client";

export function UserCard({ user, onEdit, onRemove }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
      <div>
        <span className="font-medium">{user.name.value}</span>
        <span className="text-zinc-500 ml-2">{user.email.value}</span>
        <span className="text-xs bg-zinc-200 dark:bg-zinc-700 px-2 py-0.5 rounded ml-2">
          {user.role.value}
        </span>
      </div>
      <div className="flex gap-2">
        <button onClick={onEdit} className="text-blue-500 text-sm">Edit</button>
        <button onClick={onRemove} className="text-red-500 text-sm">Remove</button>
      </div>
    </div>
  );
}
```

### 2.5 Компонент `AddUserForm.tsx`

Локальный стейт для нового пользователя, добавление через `list.add(values)`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

export function AddUserForm({ onAdd }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const handleAdd = () => {
    if (!name || !email) return;
    onAdd({ name, email, role: "user" }); // list.add(values) → upsert + add to list
    setName("");
    setEmail("");
  };

  return (
    <div className="flex gap-2 items-end pt-2 border-t border-zinc-200 dark:border-zinc-800">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Name"
        className="..."
      />
      <input
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Email"
        className="..."
      />
      <Button size="sm" color="primary" onPress={handleAdd}>Add User</Button>
    </div>
  );
}
```

### 2.6 Компонент `EntityEditModal.tsx`

Демонстрирует **Entity Projection** — `useForm(entity, templateSelector)`:

```tsx
"use client";

import { useForm } from "@palistor/react/useForm";
import { catalogStore, useCatalogForm } from "@/config/catalog/catalogConfig";
import { Input } from "@/components/Input";

export function EntityEditModal({ entityId, onClose }) {
  const form = useCatalogForm();
  const entity = form.users.getById(entityId);
  
  if (!entity) return null;

  // Entity Projection: entity + template = реактивная форма
  const editForm = useForm(entity, (s) => s.editUser);

  if (editForm.loading) {
    return <div>Loading details...</div>;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 w-96 space-y-4">
        <h3 className="text-lg font-semibold">Edit User</h3>
        
        <Input {...editForm.name} onValueChange={editForm.name.onValueChange} />
        <Input {...editForm.email} onValueChange={editForm.email.onValueChange} />
        <Input {...editForm.role} onValueChange={editForm.role.onValueChange} />
        <Input {...editForm.bio} onValueChange={editForm.bio.onValueChange} />
        <Input {...editForm.department} onValueChange={editForm.department.onValueChange} />
        <Input {...editForm.phone} onValueChange={editForm.phone.onValueChange} />
        
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
```

### 2.7 Компонент `ProductsListSection.tsx`

Демонстрирует:
- **list resolve с auto-deps** — продукты перезагружаются при смене фильтра
- **Фильтрация через обычное поле** — categoryFilter управляет resolve
- **list.map()** для рендеринга

```tsx
"use client";

import { useCatalogForm } from "@/config/catalog/catalogConfig";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "electronics", label: "Electronics" },
  { value: "furniture", label: "Furniture" },
];

export function ProductsListSection() {
  const form = useCatalogForm();
  const products = form.products;

  return (
    <div className="space-y-4">
      {/* Фильтр → триггерит re-resolve продуктов через auto-deps */}
      <Select
        {...form.categoryFilter}
        options={CATEGORIES}
        selectedKeys={form.categoryFilter.value ? [form.categoryFilter.value] : []}
        onSelectionChange={(keys) => {
          const val = [...keys][0] as string || "";
          form.categoryFilter.value = val;
        }}
      />

      {products.loading && <div className="animate-pulse">Loading products...</div>}

      <div className="space-y-1">
        {products.map((product, i, id) => (
          <div key={id} className="flex justify-between p-2 rounded bg-zinc-50 dark:bg-zinc-800">
            <span>{product.title.value}</span>
            <span className="font-mono">${product.price.value}</span>
            <span className={product.inStock.value ? "text-green-500" : "text-red-500"}>
              {product.inStock.value ? "In Stock" : "Out of Stock"}
            </span>
          </div>
        ))}
      </div>

      <div className="text-sm text-zinc-500">
        Total: {products.length} products
        {products.dirty && " · Modified"}
      </div>
    </div>
  );
}
```

### 2.8 Компонент `ListStatsPanel.tsx`

Панель статистики для визуализации состояния списков:

```tsx
"use client";

import { useCatalogForm, catalogStore } from "@/config/catalog/catalogConfig";

export function ListStatsPanel() {
  const form = useCatalogForm();

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border p-6">
      <h3 className="font-semibold mb-3">List Stats</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-zinc-500">Users:</span> {form.users.length}
          {form.users.loading && " ⏳"}
          {form.users.dirty && " ✏️"}
        </div>
        <div>
          <span className="text-zinc-500">Products:</span> {form.products.length}
          {form.products.loading && " ⏳"}
          {form.products.dirty && " ✏️"}
        </div>
      </div>
    </div>
  );
}
```

---

## Итерация 3: Таб "Async Resolvers"

### 3.1 Создать модуль `app-demo/src/modules/async-demo/`

**Структура:**
```
async-demo/
  index.ts
  AsyncDemo.tsx              — корневой компонент
  ResolverStatusSection.tsx  — визуализация статусов resolve
  AutoDepsSection.tsx        — демо auto-dependencies
  RetrySection.tsx           — демо retry с ошибками
  LoadingStatesSection.tsx   — демо loading на группах/списках
```

### 3.2 Компонент `AsyncDemo.tsx`

```tsx
"use client";

import { useTranslations } from "next-intl";
import { ResolverStatusSection } from "./ResolverStatusSection";
import { AutoDepsSection } from "./AutoDepsSection";
import { RetrySection } from "./RetrySection";
import { LoadingStatesSection } from "./LoadingStatesSection";

export function AsyncDemo() {
  const t = useTranslations();
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border p-6">
        <h2 className="text-xl font-semibold mb-2">{t("async.title")}</h2>
        <p className="text-zinc-500 text-sm mb-6">{t("async.subtitle")}</p>
        <div className="space-y-8">
          <LoadingStatesSection />
          <AutoDepsSection />
          <RetrySection />
          <ResolverStatusSection />
        </div>
      </div>
    </div>
  );
}
```

### 3.3 Компонент `LoadingStatesSection.tsx`

Показывает loading-состояние списков при первом доступе:

```tsx
"use client";

import { useCatalogForm } from "@/config/catalog/catalogConfig";

export function LoadingStatesSection() {
  const form = useCatalogForm();

  return (
    <div className="space-y-3">
      <h3 className="font-medium">Loading States</h3>
      <div className="grid grid-cols-3 gap-3">
        <StatusCard 
          label="Users List"
          loading={form.users.loading}
          count={form.users.length}
        />
        <StatusCard
          label="Products List"
          loading={form.products.loading}
          count={form.products.length}
        />
        <StatusCard
          label="Server Status"
          loading={form.serverStatus.loading}
          // value={form.serverStatus.status.value}
        />
      </div>
    </div>
  );
}

function StatusCard({ label, loading, count, value }: any) {
  return (
    <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      {loading ? (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : (
        <div className="text-sm font-medium text-green-600">
          {count !== undefined ? `${count} items` : value || "Ready"}
        </div>
      )}
    </div>
  );
}
```

### 3.4 Компонент `AutoDepsSection.tsx`

Демонстрирует авто-зависимости: при смене categoryFilter продукты перезагружаются.

```tsx
"use client";

import { useCatalogForm } from "@/config/catalog/catalogConfig";

export function AutoDepsSection() {
  const form = useCatalogForm();

  return (
    <div className="space-y-3">
      <h3 className="font-medium">Auto-Dependencies</h3>
      <p className="text-sm text-zinc-500">
        Change category filter → products list automatically re-fetches
      </p>
      
      <div className="flex gap-2">
        {["", "electronics", "furniture"].map(cat => (
          <button
            key={cat}
            onClick={() => { form.categoryFilter.value = cat; }}
            className={`px-3 py-1 rounded text-sm ${
              form.categoryFilter.value === cat
                ? "bg-blue-500 text-white"
                : "bg-zinc-100 dark:bg-zinc-800"
            }`}
          >
            {cat || "All"}
          </button>
        ))}
      </div>

      <div className="text-sm">
        Current filter: <code>{form.categoryFilter.value || "none"}</code>
        {" · "}Products: {form.products.loading ? "loading..." : form.products.length}
      </div>
    </div>
  );
}
```

### 3.5 Компонент `RetrySection.tsx`

Демонстрирует retry + onError:

```tsx
"use client";

import { useCatalogForm } from "@/config/catalog/catalogConfig";

export function RetrySection() {
  const form = useCatalogForm();

  return (
    <div className="space-y-3">
      <h3 className="font-medium">Retry & Error Handling</h3>
      <p className="text-sm text-zinc-500">
        serverStatus resolver fails 2 out of 3 times — retry kicks in automatically
      </p>
      
      <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800">
        <div className="text-sm">
          <div>Status: <strong>{form.serverStatus.status?.value || "—"}</strong></div>
          <div>Loading: {String(form.serverStatus.loading)}</div>
        </div>
      </div>
    </div>
  );
}
```

### 3.6 Компонент `ResolverStatusSection.tsx`

Отображает сырое состояние всех resolve в store (для отладки):

```tsx
"use client";

import { useCatalogForm, catalogStore } from "@/config/catalog/catalogConfig";

export function ResolverStatusSection() {
  useCatalogForm(); // подписка

  const values = catalogStore.getValues();

  return (
    <div className="space-y-3">
      <h3 className="font-medium">Store Values (debug)</h3>
      <pre className="text-xs bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg overflow-auto max-h-60">
        {JSON.stringify(values, null, 2)}
      </pre>
    </div>
  );
}
```

---

## Итерация 4: Обновить StatePreview и DebugPanel

### 4.1 StatePreview

Обновить боковую панель чтобы она показывала значения из обоих store (payment + catalog), переключаясь в зависимости от активного таба.

Передать `activeTab` в `StatePreview` через props или контекст. Если таб `lists` или `async` — показывать `catalogStore.getValues()`, иначе `paymentStore.getValues()`.

### 4.2 DebugPanel

Добавить секцию для `catalogStore` — показать entity count, list lengths, resolve statuses.

---

## Сводка файлов для создания/изменения

### Новые файлы:
1. `app-demo/src/config/catalog/mockApi.ts` — mock API с промисами
2. `app-demo/src/config/catalog/types.ts` — типы CatalogValues
3. `app-demo/src/config/catalog/catalogConfig.ts` — конфиг + store + хук
4. `app-demo/src/modules/lists-demo/index.ts`
5. `app-demo/src/modules/lists-demo/ListsDemo.tsx`
6. `app-demo/src/modules/lists-demo/UsersListSection.tsx`
7. `app-demo/src/modules/lists-demo/ProductsListSection.tsx`
8. `app-demo/src/modules/lists-demo/UserCard.tsx`
9. `app-demo/src/modules/lists-demo/ProductRow.tsx`
10. `app-demo/src/modules/lists-demo/AddUserForm.tsx`
11. `app-demo/src/modules/lists-demo/EntityEditModal.tsx`
12. `app-demo/src/modules/lists-demo/ListStatsPanel.tsx`
13. `app-demo/src/modules/async-demo/index.ts`
14. `app-demo/src/modules/async-demo/AsyncDemo.tsx`
15. `app-demo/src/modules/async-demo/ResolverStatusSection.tsx`
16. `app-demo/src/modules/async-demo/AutoDepsSection.tsx`
17. `app-demo/src/modules/async-demo/RetrySection.tsx`
18. `app-demo/src/modules/async-demo/LoadingStatesSection.tsx`

### Изменяемые файлы:
1. `app-demo/src/modules/header/TabNavigation.tsx` — добавить табы "lists", "async"
2. `app-demo/src/app/page.tsx` — подключить catalogStore, рендерить новые табы
3. `app-demo/messages/en.json` — переводы для catalog/async
4. `app-demo/messages/ru.json` — переводы для catalog/async
5. `app-demo/src/modules/state-preview/StatePreview.tsx` — показывать нужный store
6. `app-demo/src/modules/debug-panel/DebugPanel.tsx` — секция для catalogStore

---

## Инструкции для Sonnet

### Порядок выполнения

**Итерация 1** (инфраструктура):
1. Создать `config/catalog/mockApi.ts`, `types.ts`, `catalogConfig.ts`
2. Изменить `TabNavigation.tsx` — добавить "lists" и "async" табы
3. Изменить `page.tsx` — импорт catalogStore, useTranslator, рендер новых табов
4. Добавить переводы в `en.json` и `ru.json`
5. Проверить что приложение собирается без ошибок

**Итерация 2** (Lists & Entities):
1. Создать все файлы в `modules/lists-demo/`
2. Компоненты должны использовать list proxy API: `.items`, `.map()`, `.add()`, `.remove()`, `.getById()`, `.loading`, `.dirty`, `.length`
3. EntityEditModal должен использовать `useForm(entity, (s) => s.editUser)` — entity projection
4. Проверить что таб рендерится

**Итерация 3** (Async Resolvers):
1. Создать все файлы в `modules/async-demo/`
2. Показать loading states, auto-deps (смена фильтра → refetch), retry visual
3. Проверить рендеринг

**Итерация 4** (полировка):
1. Обновить StatePreview для показа catalogStore при активных табах lists/async
2. Обновить DebugPanel

### Важные детали реализации

- **ListProxy API**: доступ через `form.users` (не `form.users.value`). Это прокси со свойствами `items`, `length`, `loading`, `dirty`, `add()`, `remove()`, `getById()`, `setItems()`, `map()`
- **Entity Projection**: `useForm(entity, (s) => s.editUser)` — entity берётся из `list.getById(id)`, templateSelector указывает на группу в store proxy
- **list.map(fn)**: `fn(item, index, id)` — item это EntityProjectionProxy, id = entityId строка
- **list.add(data)**: если передан объект — upsert entity + добавить в список. Если строка — добавить существующий entity по id
- **list.remove(id)**: убирает из itemIds (entity остаётся в registry)
- **resolve в listConfig** — `array[1].resolve` — resolver возвращает массив объектов, каждый автоматически upsertится как entity
- **resolve в группе** — `serverStatus.resolve` — resolver возвращает объект, данные мёрджатся в группу
- **Auto-deps**: resolver получает tracking proxy values; прочитанные пути автоматически становятся зависимостями
- **loading**: на ListProxy это `form.users.loading`, на группе `form.serverStatus.loading`
- **UI компоненты** уже есть: `Input`, `Select`, `Button`, `Checkbox` — использовать их. Они принимают `FieldProxyNode` props
- **Стилизация**: Tailwind CSS (zinc palette), dark mode через `dark:` prefix. Округлённые карточки с `rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800`
- **Все команды "use client"** обязательны для компонентов Next.js с хуками
- **Не использовать `Suspense`** в этом демо — показывать loading через `form.users.loading` флаг

### Конфиг catalogConfig — особенности

- ListNode записывается как массив в конфиге: `users: [template, listConfig]`
- template — обычная group-нода с листовыми полями (каждое поле = `{ value: "default" }`)
- listConfig (опционально) — объект с `resolve: { resolver: async fn }`
- Группа с resolve: `serverStatus: { nested: true, resolve: { ... }, field1: { value: "" }, ... }`
- editUser — template для entity projection, можно пометить `isVisible: false` чтобы скрыть из основной формы

### Стиль кода

- TypeScript, "use client" директивы
- Импорты из `@palistor/react/useForm`, `@palistor/store/store`, `@palistor` (типы)
- Компоненты: именованные экспорты, функциональные компоненты
- Хук `useCatalogForm()` = `useForm(catalogStore)` с кастом типов
