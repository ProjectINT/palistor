# Palistor — План рефакторинга на классы

## Проблема сейчас

Текущая архитектура — одна гигантская фабрика `createProxyStore`, которая:

1. **Прокидывает deps повсюду** — каждый пайплайн получает объект зависимостей (`WriteDeps`, `SubmitDeps`, `ResolveDeps`, `OnChangeDeps`...), в каждом из которых повторяются `nodeState`, `recomputeAll`, `notifyChanged`, `valuesCache`.
2. **Нет единого места для состояния** — `nodeState`, `nodePaths`, `nodeParents`, `valuesCache`, `groupDeps`, `leafNodes`, `groupLeafMap` — свободные переменные в замыкании. Их нельзя инспектировать, расширять, тестировать отдельно.
3. **Нет методов для работы с деревом** — поиск узла по пути, обход потомков, получение родителя — это рассыпано по разным файлам через `WeakMap`-ы, переданные аргументами.
4. **Глобальные сервисы (translator, notifier) — через замыкание** — приходится оборачивать в стабильные функции-делегаты и прокидывать вглубь.
5. **Трудно расширять** — добавление нового пайплайна или нового глобального сервиса требует изменения `createProxyStore` и всех `*Deps`.

---

## Целевая архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│              Palistor<TConfig>  (публичный класс)               │
│  Единственный объект, хранящий ВСЁ состояние store.             │
│  Реализует ProxyStore<TConfig> → useForm(store) работает.       │
│  Все подсистемы получают ссылку на this, не на россыпь deps.    │
│                                                                 │
│  PUBLIC (ProxyStore interface):                                 │
│  ├─ proxy: ConfigProxy<TConfig> (реактивный прокси)             │
│  ├─ persist: PersistManager                                     │
│  ├─ subscribe / subscribeGlobal / getVersion / getNodeVersion   │
│  ├─ getValues / setValues / setTranslator / setNotifier         │
│  ├─ submit() → SubmitResult                                    │
│  └─ reset(values?) → void                                      │
│                                                                 │
│  @internal (доступно пайплайнам через this):                    │
│  ├─ rootConfig: object          (неизменяемый конфиг)           │
│  ├─ nodes: NodeRegistry         (nodeState, paths, parents)     │
│  ├─ values: ValuesCache         (мутабельный снапшот значений)  │
│  ├─ hub: NotificationHub        (версии, подписки)              │
│  ├─ services: ServiceRegistry   (translator, notifier, ...)     │
│  ├─ dirty: DirtyTracker         (initialValues, recompute)      │
│  ├─ deps: GroupDepsMap          (межгрупповые зависимости)      │
│  └─ resolveManager: ResolveManager (resolve-состояния, trigger) │
│                                                                 │
│  @internal методы-фасады:                                       │
│  ├─ recomputeAll(changed?) → Set<object>                        │
│  ├─ notifyChanged(changed) → void                               │
│  └─ recomputeAndNotify(changed?) → void                         │
└─────────────────────────────────────────────────────────────────┘
         │
         │  this (kernel)
         ▼
┌──────────────────────┐  ┌──────────────────────┐
│   WritePipeline      │  │   SubmitPipeline      │
│   constructor(kernel)│  │   constructor(kernel) │
│   execute(node, val) │  │   execute(node)       │
└──────────────────────┘  └──────────────────────┘
┌──────────────────────┐  ┌──────────────────────┐
│   ResetPipeline      │  │   ResolvePipeline     │
│   constructor(kernel)│  │   constructor(kernel) │
│   execute(node, vals)│  │   execute(node, cfg)  │
└──────────────────────┘  └──────────────────────┘
┌──────────────────────┐  ┌──────────────────────┐
│   OnChangePipeline   │  │   ProxyBuilder        │
│   constructor(kernel)│  │   constructor(kernel) │
│   fire(node, new, old│  │   build(node) → Proxy │
└──────────────────────┘  └──────────────────────┘
```

### Принцип: Palistor — это DI-контейнер + публичный API

Каждая подсистема принимает **один** аргумент — `Palistor` instance (как `kernel`). Оттуда она достаёт всё, что ей нужно. При добавлении нового глобального состояния или сервиса — меняется **только Palistor**, а не сигнатуры 15 функций.

При этом `Palistor` реализует `ProxyStore` интерфейс → `useForm(store)`, `store.proxy.email.value`, `{...form.email}` работают **без обёрток и маппинга**.

---

## Детальный план классов

### 1. `NodeRegistry` — реестр узлов и их состояния

Объединяет: `nodeState`, `nodePaths`, `nodeParents`, `leafNodes`, `groupLeafMap`, `proxyCache`.

```ts
class NodeRegistry {
  /** Вычисленное состояние каждого узла. */
  readonly state: WeakMap<object, FieldState>;

  /** Узел → dot-путь ("passport.number"). */
  readonly paths: WeakMap<object, string>;

  /** Узел → родительский узел. */
  readonly parents: WeakMap<object, object>;

  /** Все листовые узлы с путями. */
  readonly leaves: Array<{ node: object; path: string }>;

  /** Группа → её прямые листья. */
  readonly groupLeaves: WeakMap<object, object[]>;

  /** Кэш Proxy-объектов (1 прокси на узел). */
  readonly proxyCache: WeakMap<object, unknown>;

  constructor(rootConfig: object, initialValues: Record<string, unknown>) {
    // registerNodes → заполнить state, leaves, groupLeaves
    // buildNodeMaps → заполнить paths, parents
  }

  // ─── Методы для работы с деревом ──────────────────────────────

  /** Получить состояние узла (или undefined). */
  getState(node: object): FieldState | undefined;

  /** Обновить состояние узла. */
  setState(node: object, state: FieldState): void;

  /** Путь узла ("passport.number"). */
  getPath(node: object): string | undefined;

  /** Родитель узла. */
  getParent(node: object): object | undefined;

  /** Группа, к которой принадлежит узел. */
  getGroup(node: object): object | undefined;

  /** Путь группы для узла (поднимается к ближайшему group ancestor). */
  getGroupPath(node: object): string;

  /** Все листья данной группы. */
  getGroupLeaves(group: object): object[];

  /** Обход всех листьев дерева. */
  forEachLeaf(fn: (node: object, path: string) => void): void;

  /** Найти узел по dot-пути. */
  findByPath(root: object, path: string): object | undefined;

  /** Является ли узел листовым. */
  isLeaf(node: object): boolean;

  /** Является ли узел групповым. */
  isGroup(node: object): boolean;
}
```

**Что даёт:**
- Единое место для CRUD над состоянием узлов
- Методы навигации по дереву вместо raw `WeakMap.get`
- Легко добавлять новые индексы (например, node → все потомки)
- Тестируется отдельно от всего остального

---

### 2. `ServiceRegistry` — глобальные сервисы

Объединяет: `translator`, `notifier`, и любые будущие сервисы.

```ts
class ServiceRegistry {
  private _translator: TranslateFn = (v) => v;
  private _notifier: NotifyFn = () => {};

  /** Стабильная ссылка — безопасно передавать куда угодно. */
  readonly translate: TranslateFn = (...args) => this._translator(...args);
  readonly notify: NotifyFn = (...args) => this._notifier(...args);

  setTranslator(t: TranslateFn | null): void;
  getTranslator(): TranslateFn;

  setNotifier(fn: NotifyFn | null): void;
  getNotifier(): NotifyFn;
}
```

**Что даёт:**
- `kernel.services.translate` доступен везде без прокидывания
- Стабильные делегаты создаются один раз при конструировании
- Добавление нового сервиса — одно поле + getter/setter

---

### 3. `ValuesCache` — остаётся как есть, но становится полем kernel

```ts
// Без изменений — уже хороший самостоятельный модуль.
// Просто переезжает в kernel.values
```

---

### 4. `DirtyTracker` — отслеживание грязных полей

Объединяет: `initialValueMap`, `captureInitialValues`, `recomputeDirty`, `mergeInitialValues`.

```ts
class DirtyTracker {
  private readonly initialValues: WeakMap<object, unknown>;

  constructor(private kernel: Palistor<any>) {
    // captureInitialValues from current nodeState
  }

  /** Захватить текущие значения как baseline. */
  capture(): void;

  /** Обновить baseline для конкретных узлов (после resolve). */
  merge(nodes: object[]): void;

  /** Пересчитать dirty-флаги всего дерева. Возвращает изменённые узлы. */
  recompute(): { changed: Set<object>; anyDirty: boolean };

  /** Проверить, отличается ли текущее значение от initial. */
  isDirty(node: object): boolean;

  /** Доступ к карте (для ResolvePipeline). */
  get initialValueMap(): WeakMap<object, unknown>;
}
```

---

### 5. `GroupDepsMap` — межгрупповые зависимости

Объединяет: `groupDeps`, `createTrackingValues`, `getNodeGroupPath`, `resolveGroupByPath`.

```ts
class GroupDepsMap {
  private readonly deps = new Set<string>();
  private built = false;

  constructor(private kernel: Palistor<any>) {
    // createGroupDeps — self-deps
  }

  /** Создать tracking proxy для сбора зависимостей при init-recompute. */
  createTrackingWrap(): TrackingWrap;

  /** Пометить что зависимости построены, освободить кэш прокси. */
  markBuilt(): void;

  /** Все группы-реципиенты, зависящие от donor-группы. */
  getRecipients(donorPath: string): string[];

  /** Добавить зависимость. */
  addDep(donorPath: string, recipientPath: string): void;

  get isBuilt(): boolean;
}
```

---

### 6. `NotificationHub` — без крупных изменений

Уже хорошо изолирован. Разница — получает kernel вместо россыпи deps.

```ts
class NotificationHub {
  private version = 0;
  private readonly nodeVersions = new WeakMap<object, number>();
  private readonly nodeListeners = new WeakMap<object, Set<() => void>>();
  private readonly globalListeners = new Set<() => void>();
  private postNotifyHook: ((paths: Set<string>) => void) | null = null;

  constructor(private kernel: Palistor<any>) {}

  notifyChanged(changed: Set<object>): void {
    // dirty recompute через kernel.dirty
    // version++ через kernel.notifications (this)
    // postNotifyHook
  }

  subscribe(node: object, listener: () => void): Unsubscribe;
  subscribeGlobal(listener: () => void): Unsubscribe;
  getVersion(): number;
  getNodeVersion(node: object): number;
  bumpLeafVersions(): void;
  setPostNotifyHook(hook: ((paths: Set<string>) => void) | null): void;
}
```

---

### 7. `ResolveManager` — без крупных изменений

```ts
class ResolveManager {
  readonly states = new Map<object, ResolveState>();
  private readonly entries: Map<object, Resolve>;

  constructor(private kernel: Palistor<any>) {
    // initResolveStates
  }

  trigger(node: object): void;
  getState(node: object): ResolveState | undefined;
  createPostNotifyHook(): ((paths: Set<string>) => void) | null;
  launchEager(): void;
}
```

---

### 8. `Palistor` — публичный класс (он же kernel)

`Palistor` — это и DI-контейнер для внутренних подсистем, и публичный API.
Реализует интерфейс `ProxyStore` напрямую на инстансе → `useForm(store)` работает без обёрток.

```ts
/**
 * Публичный класс. Создание store:
 *
 *   const store = new Palistor({ config, initialValues });
 *   store.proxy.email.value        // GET → FieldState
 *   store.proxy.email.value = "x"  // SET → write pipeline
 *   useForm(store)                 // React hook — работает напрямую
 *   {...form.email}                // spread — ownKeys скрывает внутренности
 */
class Palistor<TConfig extends Record<string, any>> implements ProxyStore<TConfig> {
  // ─── Публичный API (интерфейс ProxyStore) ──────────────────

  readonly proxy: ConfigProxy<TConfig>;
  readonly persist: PersistManager;

  // ─── Внутренние подсистемы (доступны пайплайнам через this) ──

  /** @internal */ readonly rootConfig: object;
  /** @internal */ readonly nodes: NodeRegistry;
  /** @internal */ readonly values: ValuesCache;
  /** @internal */ readonly services: ServiceRegistry;
  /** @internal */ readonly dirty: DirtyTracker;
  /** @internal */ readonly deps: GroupDepsMap;
  /** @internal */ readonly hub: NotificationHub;
  /** @internal */ readonly resolveManager: ResolveManager;

  // ─── Пайплайны ─────────────────────────────────────────────

  /** @internal */ private readonly _write: WritePipeline;
  /** @internal */ private readonly _submit: SubmitPipeline;
  /** @internal */ private readonly _reset: ResetPipeline;
  /** @internal */ private readonly _onChange: OnChangePipeline;
  /** @internal */ private readonly _proxy: ProxyBuilder;

  constructor(options: ProxyStoreOptions<TConfig>) {
    this.rootConfig = options.config;

    // 1. Подсистемы (порядок важен!)
    this.services = new ServiceRegistry();
    this.nodes = new NodeRegistry(this.rootConfig, options.initialValues ?? {});
    this.values = buildValuesCache(this.rootConfig, this.nodes.state);
    this.dirty = new DirtyTracker(this);
    this.deps = new GroupDepsMap(this);
    this.hub = new NotificationHub(this);
    this.resolveManager = new ResolveManager(this);

    // 2. Пайплайны
    this._write = new WritePipeline(this);
    this._submit = new SubmitPipeline(this);
    this._reset = new ResetPipeline(this);
    this._onChange = new OnChangePipeline(this);
    this._proxy = new ProxyBuilder(this);
    this.persist = new PersistManager(this);

    // 3. Init
    this.recomputeAll();           // первый полный пересчёт + строит groupDeps
    this.deps.markBuilt();
    this.dirty.capture();          // baseline для dirty tracking

    // 4. Resolve system
    const hook = this.resolveManager.createPostNotifyHook();
    if (hook) this.hub.setPostNotifyHook(hook);
    this.resolveManager.launchEager();

    // 5. Публичный proxy — ПОСЛЕ всей инициализации
    this.proxy = this._proxy.build(this.rootConfig) as ConfigProxy<TConfig>;
  }

  // ─── Фасадные методы (вызываются пайплайнами через this) ───

  /** @internal Пересчитать состояние дерева. */
  recomputeAll(changedNodes?: Set<object>): Set<object> {
    if (changedNodes && changedNodes.size > 0) {
      return recomputeTargeted(changedNodes, this);
    }
    if (!this.deps.isBuilt) {
      return recomputeAllFull(this, this.deps.createTrackingWrap());
    }
    return recomputeAllFull(this);
  }

  /** @internal Уведомить подписчиков об изменениях. */
  notifyChanged(changed: Set<object>): void {
    this.hub.notifyChanged(changed);
  }

  /** @internal Пересчитать + уведомить (самый частый паттерн). */
  recomputeAndNotify(changed?: Set<object>): void {
    const allChanged = this.recomputeAll(changed);
    this.notifyChanged(allChanged);
  }

  // ─── Публичный API ProxyStore ──────────────────────────────

  subscribe(node: object, listener: () => void): Unsubscribe {
    return this.hub.subscribe(node, listener);
  }

  subscribeGlobal(listener: () => void): Unsubscribe {
    return this.hub.subscribeGlobal(listener);
  }

  getVersion(): number {
    return this.hub.getVersion();
  }

  getNodeVersion(node: object): number {
    return this.hub.getNodeVersion(node);
  }

  getValues(): ExtractValues<TConfig> {
    return structuredClone(this.values.values) as ExtractValues<TConfig>;
  }

  setTranslator(t: TranslateFn | null): void {
    this.services.setTranslator(t);
    this.hub.bumpLeafVersions();
  }

  getTranslator(): TranslateFn {
    return this.services.getTranslator();
  }

  setNotifier(fn: NotifyFn | null): void {
    this.services.setNotifier(fn);
  }

  getNotifier(): NotifyFn {
    return this.services.getNotifier();
  }

  submit(): Promise<SubmitResult> {
    return this._submit.execute(this.rootConfig);
  }

  reset(values?: DeepPartialValues<ExtractValues<TConfig>>): void {
    this._reset.execute(this.rootConfig, values as Record<string, unknown> | undefined);
  }

  setValues(patch: DeepPartialValues<ExtractValues<TConfig>>): void {
    this._write.applyPatch(this.rootConfig, patch as Record<string, unknown>);
  }
}
```

### Как это выглядит снаружи

```ts
// ─── Создание store ──────────────────────────────────────────────
import { Palistor } from "@palistor";

export const paymentStore = new Palistor({
  config: paymentFormConfig,
  initialValues: paymentFormDefaults,
});

// ─── React hook ──────────────────────────────────────────────────
export const usePaymentForm = () => useForm(paymentStore) as any;

// ─── Компонент ───────────────────────────────────────────────────
function Calculator() {
  const form = usePaymentForm();
  return (
    <Section title={t("sections.calculator")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input {...form.price} />      {/* spread работает — ownKeys */}
        <Input {...form.quantity} />
        <Input {...form.total} />
      </div>
    </Section>
  );
}

// ─── Вложенный компонент — independent tracking ──────────────────
function PassportSection({ passport }) {
  const p = useForm(passport);   // принимает proxy subtree из пропса
  if (!p.isVisible) return null;
  return <input value={p.number.value} onChange={e => { p.number.value = e.target.value }} />;
}

// ─── Программный доступ (вне React) ──────────────────────────────
paymentStore.proxy.email.value = "test@example.com";  // write
paymentStore.submit();                                  // submit
paymentStore.reset();                                   // reset
paymentStore.setValues({ email: "new@test.com" });      // bulk update
paymentStore.getValues();                                // snapshot
```

### Почему `Palistor` — и kernel, и public API в одном классе

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| `Kernel` + `toPublicAPI()` → plain object | Скрывает внутренности | `useForm` получает plain object, нет `instanceof`, лишний маппинг |
| `Palistor` = kernel + public API | Один объект, `instanceof Palistor`, `useForm(store)` напрямую, `new Palistor()` | Внутренние поля видны (решается `@internal` + `/** @internal */`) |
| Отдельный `Palistor` wrapper вокруг kernel | Чистое разделение | Лишний объект, двойной проброс, сложнее |

**Выбор: Palistor = kernel.** Внутренние подсистемы помечены `@internal` — TypeScript не предлагает их в autocomplete при обычном использовании. Пайплайны (`_write`, `_submit`...) private — вообще не видны.

### Совместимость с `useForm`

`useForm` вызывает `resolveInput(input)`, который делает:

```ts
// Если НЕ tracking proxy → считает input за ProxyStore:
return { store: input, sourceProxy: input.proxy };
```

Далее использует:
- `store.subscribeGlobal(fn)` — есть метод
- `store.getVersion()` — есть метод  
- `store.getNodeVersion(node)` — есть метод
- `store.proxy` — есть свойство

Все четыре — публичные свойства/методы `Palistor`. **useForm работает без изменений.**

### Совместимость со spread `{...form.email}`

Spread проходит через `ownKeys()` trap в Proxy → `computeProxyKeys()` → 
возвращает `SPREADABLE_FIELD_STATE_PROPS` для field nodes (`value`, `label`, `isVisible`, ..., `onValueChange`).
Внутренние ключи (`validate`, `formatter`, `setter`...) скрыты.

**Spread работает без изменений** — это логика ProxyBuilder, она не зависит от того, класс Palistor или фабрика.

### Обратная совместимость: `createProxyStore` как алиас

```ts
// store/index.ts — для плавной миграции
export { Palistor };

/** @deprecated Use `new Palistor(options)` instead. */
export function createProxyStore<TConfig extends Record<string, any>>(
  options: ProxyStoreOptions<TConfig>,
): Palistor<TConfig> {
  return new Palistor(options);
}
```

Старый код не ломается. Новый код использует `new Palistor(...)`.

### `useForm` subtree: как пайплайн `ProxyBuilder` пробрасывает store ref

Сейчас `createTrackingProxy` использует символ `STORE_REF` чтобы вложенный `useForm(form.passport)` мог найти исходный store. В новой архитектуре:

```ts
class ProxyBuilder {
  build(node: object): unknown {
    // В Proxy GET trap:
    if (key === STORE_REF) return this.kernel;  // kernel IS the Palistor instance IS the store
    // ...
  }
}
```

`unwrapTrackingProxy` получает `STORE_REF` → это `Palistor` instance → у него есть `.subscribeGlobal`, `.getVersion`, `.proxy` → всё работает.
```

---

### 9. Классы пайплайнов

Каждый пайплайн — тонкий класс, который берёт всё из `kernel`:

```ts
class WritePipeline {
  constructor(private kernel: Palistor<any>) {}

  execute(node: object, rawValue: unknown, previousValue?: unknown): WriteResult | null {
    const { nodes, values, rootConfig } = this.kernel;

    // 1. format
    const formatted = formatValue(node, rawValue, values.values);
    // 2. skip check
    if (Object.is(formatted, nodes.getState(node)?.value)) return { changed: new Set(), skipped: true };
    // 3. store
    storeValue(node, formatted, nodes.state, values);
    // 4. setter → applyPatch
    const changed = runSetter(node, formatted, previousValue, rootConfig, nodes.state, values);
    // 5. recompute
    const recomputeChanged = this.kernel.recomputeAll(changed);
    // 6. merge
    return { changed: mergeChanged(changed, recomputeChanged) };
  }
}
```

```ts
class SubmitPipeline {
  constructor(private kernel: Palistor<any>) {}

  async execute(node: object): Promise<SubmitResult> {
    const { nodes, values, notifications } = this.kernel;
    // ... всё через this.kernel.*, без отдельного SubmitDeps
  }
}
```

```ts
class ResetPipeline {
  constructor(private kernel: Palistor<any>) {}

  execute(node: object, overrideValues?: Record<string, unknown>): void {
    // ... через this.kernel.*
  }
}
```

```ts
class OnChangePipeline {
  constructor(private kernel: Palistor<any>) {}

  fire(node: object, newValue: unknown, previousValue: unknown): void {
    // ... через this.kernel.*
  }
}
```

```ts
class ProxyBuilder {
  constructor(private kernel: Palistor<any>) {}

  build(node: object): unknown {
    // Аналогично текущему createBuildProxy, но всё через this.kernel
  }
}
```

---

## Граф зависимостей: до и после

### До (deps-мешанина)

```
createProxyStore()
  ├─ nodeState ──────────► WriteDeps, SubmitDeps, ResolveDeps, OnChangeDeps,
  │                        ResetDeps, BuildProxyDeps, NotificationHub, ResolveManager
  ├─ recomputeAll ───────► WriteDeps, SubmitDeps, ResolveDeps, OnChangeDeps,
  │                        ResetDeps, ResolveManager
  ├─ notifyChanged ──────► SubmitDeps, ResolveDeps, OnChangeDeps, ResetDeps,
  │                        ResolveManager
  ├─ valuesCache ────────► WriteDeps, SubmitDeps, ResolveDeps, OnChangeDeps,
  │                        ResetDeps, BuildProxyDeps, ResolveManager
  ├─ translate ──────────► BuildProxyDeps (+ stubs everywhere)
  ├─ nodePaths ──────────► SubmitDeps, OnChangeDeps, NotificationHub
  ├─ nodeParents ────────► OnChangeDeps
  └─ initialValueMap ────► ResetDeps, ResolveManager, NotificationHub
```

### После (kernel)

```
Palistor (implements ProxyStore)
  ├─ nodes        ← NodeRegistry (state, paths, parents, leaves)
  ├─ values       ← ValuesCache
  ├─ services     ← ServiceRegistry (translate, notify)
  ├─ dirty        ← DirtyTracker (initialValues)
  ├─ deps         ← GroupDepsMap
  ├─ hub          ← NotificationHub
  └─ resolveManager ← ResolveManager

WritePipeline(palistor)     — читает palistor.nodes, palistor.values
SubmitPipeline(palistor)    — читает palistor.*
ResetPipeline(palistor)     — читает palistor.*
OnChangePipeline(palistor)  — читает palistor.*
ProxyBuilder(palistor)      — читает palistor.*
```

Каждый класс обращается к `this.kernel.nodes.getState(node)` вместо `deps.nodeState.get(node)`. Один аргумент вместо 8.

`useForm(store)` работает напрямую — `store` IS Palistor instance, у которого есть `.proxy`, `.subscribeGlobal()`, `.getVersion()`, `.getNodeVersion()`.

---

## Порядок миграции (пошагово)

### Фаза 0: Подготовка

1. **Зафиксировать тесты.** Убедиться, что все текущие тесты проходят. Они — страховочная сетка.
2. **Написать integration-тест**, покрывающий основной flow: init → write → recompute → notify → submit → reset → resolve. Он не должен меняться после рефакторинга.

### Фаза 1: `NodeRegistry` (низкий риск)

1. Создать класс `NodeRegistry` в `store/nodeRegistry.ts`.
2. Перенести в него логику из `registerNodes`, `buildNodeMaps`, `initGroupSubmitting`.
3. Добавить методы `getState`, `setState`, `getPath`, `getParent`, `getGroupPath`, `forEachLeaf`, `isLeaf`, `isGroup`.
4. В `createProxyStore` — заменить россыпь `WeakMap`-ов на `new NodeRegistry(...)`.
5. **Тесты:** адаптировать unit-тесты `registerNodes`, `nodeMap`. Добавить тесты на новые методы навигации.

### Фаза 2: `ServiceRegistry` (низкий риск)

1. Создать `ServiceRegistry` в `store/serviceRegistry.ts`.
2. Перенести `translator`, `notifier`, стабильные делегаты `translate`, `notify`.
3. В `createProxyStore` — заменить переменные на `new ServiceRegistry()`.
4. **Тесты:** тривиальные, проверить делегацию.

### Фаза 3: `DirtyTracker` (низкий риск)

1. Создать `DirtyTracker` в `store/dirtyTracker.ts`.
2. Перенести `initialValueMap`, `captureInitialValues`, `mergeInitialValues`, `recomputeDirty`.
3. **Тесты:** адаптировать `dirtyTracking.test.ts`.

### Фаза 4: `GroupDepsMap` (средний риск)

1. Создать `GroupDepsMap` в `store/groupDepsMap.ts`.
2. Перенести `groupDeps`, `createTrackingValues`, кэш tracking proxy.
3. **Тесты:** адаптировать тесты из `groupDeps/tests/`.

### Фаза 5: `NotificationHub` → класс (низкий риск)

1. Превратить фабрику `createNotificationHub` в класс `NotificationHub`.
2. Конструктор принимает kernel (но пока передаём отдельные deps — промежуточный шаг).
3. **Тесты:** адаптировать (API не меняется).

### Фаза 6: `ResolveManager` → класс (низкий риск)

1. Превратить фабрику `createResolveManager` в класс.
2. **Тесты:** адаптировать.

### Фаза 7: `Palistor` класс (ключевая фаза)

1. Создать класс `Palistor` в `store/palistor.ts`.
2. Реализовать `ProxyStore` интерфейс на инстансе (proxy, subscribe, submit, reset...).
3. Собрать все подсистемы из фаз 1–6 как `@internal` поля.
4. Реализовать `recomputeAll`, `notifyChanged`, `recomputeAndNotify` как `@internal` методы.
5. Переписать `createProxyStore` → `return new Palistor(options)` (обратная совместимость).
6. `useForm(store)` работает без изменений — store реализует ProxyStore.
7. **Тесты:** запустить ВСЕ тесты. Integration-тест из фазы 0 должен пройти без изменений.

### Фаза 8: Классы пайплайнов (средний риск)

1. По одному конвертировать каждый пайплайн в класс:
   - `WritePipeline` ← `writePipeline.ts`
   - `SubmitPipeline` ← `submitPipeline.ts`
   - `ResetPipeline` ← `resetPipeline.ts`
   - `OnChangePipeline` ← `onChangePipeline.ts`
   - `ProxyBuilder` ← `buildProxy.ts`
2. Каждый класс принимает `kernel` в конструкторе.
3. Удалить все `*Deps` интерфейсы.
4. **Тесты:** адаптировать посписочно. После каждого пайплайна — прогон всех тестов.

### Фаза 9: `PersistManager` → принимает kernel (средний риск)

1. Конструктор принимает `kernel` вместо рассыпчатых deps.
2. **Тесты:** адаптировать `persist.test.ts`.

### Фаза 10: Cleanup

1. Удалить все неиспользуемые `*Deps` интерфейсы.
2. Удалить файлы-обёртки, которые стали не нужны.
3. Обновить реэкспорты в `index.ts`.
4. Обновить `architecture.md`.

---

## Структура файлов: после рефакторинга

```
store/
  palistor.ts                   ← NEW: Palistor (публичный класс = kernel + ProxyStore)
  nodeRegistry.ts               ← NEW: NodeRegistry (состояние + навигация)
  serviceRegistry.ts            ← NEW: ServiceRegistry (translator, notifier)
  dirtyTracker.ts               ← NEW: DirtyTracker
  groupDepsMap.ts               ← NEW: GroupDepsMap
  constants.ts                  (без изменений)

  compute/
    computeFieldState.ts        (без изменений — чистая функция)
    fieldStateChanged.ts        (без изменений)
    isEmpty.ts                  (без изменений)
    resolveFlag.ts              (без изменений)
    resolveString.ts            (без изменений)
    types.ts                    (без изменений)
    recompute/
      recomputeAll.ts           сигнатура: (kernel, trackingWrap?) → Set
      recomputeTargeted.ts      сигнатура: (changedNodes, kernel) → Set
      recomputeLeaves.ts        (без изменений — чистая функция)
      recomputeGroup.ts         (без изменений)
      collectGroupLeafNodes.ts  (без изменений)
      topologicalSortComputed.ts (без изменений)

  notifications/
    notificationHub.ts          ← MOVED: класс NotificationHub

  resolve/
    resolveManager.ts           ← класс ResolveManager
    executeResolve.ts           сигнатура: (node, cfg, kernel) → void
    findResolvesToRetrigger.ts  (без изменений)
    initResolveStates.ts        (без изменений)
    resetResolveState.ts        (без изменений)
    createValuesTrackingProxy.ts (без изменений)
    applyPendingWrites.ts       (без изменений)
    types.ts                    удалить ResolveDeps, остальное оставить

  pipelines/
    writePipeline.ts            ← класс WritePipeline
    submitPipeline.ts           ← класс SubmitPipeline
    resetPipeline.ts            ← класс ResetPipeline
    onChangePipeline.ts         ← класс OnChangePipeline

  proxy/
    proxyBuilder.ts             ← класс ProxyBuilder
    computeProxyKeys.ts         (без изменений)
    handleLazyResolve.ts        (без изменений)
    initProxyCaches.ts          (без изменений)

  persist/
    persistManager.ts           конструктор: (kernel, options)
    drivers.ts                  (без изменений)
    types.ts                    удалить старые deps-типы

  applyPatch/
    applyPatch.ts               (без изменений — чистая функция)

  valuesCache/
    valuesCache.ts              (без изменений)

  store/
    index.ts                    ← реэкспорт: Palistor + createProxyStore (deprecated alias)
    types.ts                    ← публичные типы (ConfigNode, ProxyStore, etc.)
```

---

## Ключевые решения

### Почему Palistor-инстанс, а не глобальный синглтон?

Каждый `new Palistor(...)` создаёт **свой** инстанс. На странице может быть несколько независимых форм. Глобальный синглтон — антипаттерн.

### Почему не наследование?

`WritePipeline extends BasePipeline` — плохо. Пайплайны делают совершенно разные вещи. Композиция через kernel — каждый пайплайн берёт из kernel ровно то, что ему нужно.

### Почему не полный IoC-контейнер?

Overkill для библиотеки форм. Kernel — это ручной lightweight DI: поля создаются в конструкторе в правильном порядке, типизация — статическая.

### Чистые функции остаются функциями

`computeFieldState`, `fieldStateChanged`, `isEmpty`, `topologicalSortComputed`, `applyPatch` — это чистые функции без состояния. Оборачивать их в классы — бессмысленно. Классы — только для stateful-компонентов.

### `NodeRegistry` вместо россыпи WeakMap

Сейчас 6+ `WeakMap`-ов разбросаны по замыканию. `NodeRegistry` — единое место. Бонус: можно добавить метод `findByPath("passport.number")` для дебаг-утилит, devtools, тестов.

### Обратная совместимость API

Публичный API `ProxyStore` **не меняется**. `Palistor` implements `ProxyStore` — все поля и методы на месте. React-хуки (`useForm`, `useTranslator`, `useNotifier`, `usePersist`) — без изменений. `createProxyStore` остаётся как deprecated alias → `new Palistor(options)`.

---

## Паттерны, которые стоит внедрить

### 1. Lazy initialization через getters

```ts
class Palistor {
  private _persist?: PersistManager;

  get persist(): PersistManager {
    if (!this._persist) {
      this._persist = new PersistManager(this);
    }
    return this._persist;
  }
}
```

Persist не нужен, пока `usePersist` не вызван. Lazy creation экономит память.

### 2. Цепочка `recompute → notify` как один метод

```ts
class Palistor {
  /** Пересчитать + уведомить. Самый частый паттерн. */
  recomputeAndNotify(changed?: Set<object>): void {
    const allChanged = this.recomputeAll(changed);
    this.notifyChanged(allChanged);
  }
}
```

9 call sites в текущем коде делают `recomputeAll → notifyChanged`. Один метод вместо двух вызовов.

### 3. Debug mode

```ts
class Palistor {
  readonly debug: boolean;

  private log(event: string, data?: unknown): void {
    if (this.debug) console.log(`[palistor] ${event}`, data);
  }
}
```

Опциональный `debug: true` в `createProxyStore` — логирование всех мутаций, recompute, notify. Бесценно при разработке.

### 4. Middleware / plugin hooks (будущее)

```ts
interface StorePlugin {
  onWrite?(node: object, value: unknown): void;
  onRecompute?(changed: Set<object>): void;
  onNotify?(changed: Set<object>): void;
}

class Palistor {
  private plugins: StorePlugin[] = [];

  use(plugin: StorePlugin): void {
    this.plugins.push(plugin);
  }
}
```

Открывает дорогу к devtools, logging, analytics — без изменения ядра.

---

## Риски и митигация

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Регрессии при переносе | Средняя | Integration-тест из фазы 0 + прогон тестов после каждой фазы |
| Циклические зависимости классов | Низкая | Kernel — центр звезды, пайплайны зависят от kernel, но не друг от друга |
| Производительность (class overhead) | Минимальная | V8 отлично оптимизирует классы; прокси и WeakMap — те же |
| Порядок инициализации в конструкторе kernel | Средняя | Документировать порядок; тест на корректный init |
| Размер бандла | Минимальная | Классы tree-shakeable при ES modules; utils остаются функциями |

---

## План сессий

Рефакторинг выполняется постепенно — по 2–3 фазы за сессию. После каждой сессии все тесты должны проходить, демо должно работать.

### Сессия 1: Фундамент — фаза 0 + фаза 1

**Цель:** страховочная сетка + первый класс.

- [Х] **Фаза 0:** Прогнать все тесты, убедиться что зелёные. Написать integration-тест, покрывающий полный flow: init → write → recompute → notify → submit → reset → resolve.
- [Х] **Фаза 1:** Создать `NodeRegistry` — объединить `nodeState`, `nodePaths`, `nodeParents`, `leafNodes`, `groupLeafMap`, `proxyCache` в один класс. Добавить методы навигации. Подключить в `createProxyStore`. Адаптировать тесты.

**Контрольная точка:** все тесты зелёные, integration-тест проходит.

---

### Сессия 2: Сервисы и dirty — фаза 2 + фаза 3

**Цель:** вынести глобальные сервисы и dirty tracking в классы.

- [Х] **Фаза 2:** Создать `ServiceRegistry` — перенести `translator`, `notifier`, стабильные делегаты. Подключить в `createProxyStore`.
- [Х] **Фаза 3:** Создать `DirtyTracker` — перенести `initialValueMap`, `captureInitialValues`, `mergeInitialValues`, `recomputeDirty`. Адаптировать тесты.

**Контрольная точка:** все тесты зелёные.

---

### Сессия 3: Зависимости и подписки — фаза 4 + фаза 5

**Цель:** вынести межгрупповые зависимости и notification hub.

- [Х] **Фаза 4:** Создать `GroupDepsMap` — перенести `groupDeps`, `createTrackingValues`, кэш tracking proxy. Адаптировать тесты.
- [Х] **Фаза 5:** Превратить `createNotificationHub` в класс `NotificationHub`. Адаптировать тесты.

**Контрольная точка:** все тесты зелёные.

---

### Сессия 4: Resolve + Palistor — фаза 6 + фаза 7

**Цель:** ключевая сессия — собрать всё в `Palistor` класс.

- [Х] **Фаза 6:** Превратить `createResolveManager` в класс `ResolveManager`.
- [Х] **Фаза 7:** Создать класс `Palistor` — собрать все подсистемы, реализовать `ProxyStore` интерфейс на инстансе. `createProxyStore` → `return new Palistor(options)`. Убедиться что `useForm(store)` работает.

**Контрольная точка:** все тесты зелёные, `new Palistor(...)` работает, демо-приложение работает.

---

### Сессия 5: Пайплайны → классы — фаза 8

**Цель:** конвертировать все 5 пайплайнов в классы с `constructor(kernel)`.

- [Х] `WritePipeline` ← `writePipeline.ts` (+ адаптировать тесты)
- [Х] `SubmitPipeline` ← `submitPipeline.ts` (+ адаптировать тесты)
- [Х] `ResetPipeline` ← `resetPipeline.ts` (+ адаптировать тесты)
- [Х] `OnChangePipeline` ← `onChangePipeline.ts` (+ адаптировать тесты)
- [Х] `ProxyBuilder` ← `buildProxy.ts` (+ адаптировать тесты)

После каждого пайплайна — прогон всех тестов.

**Контрольная точка:** все тесты зелёные, все `*Deps` интерфейсы удалены.

---

### Сессия 6: Persist + cleanup — фаза 9 + фаза 10

**Цель:** финализация.

- [Х] **Фаза 9:** `PersistManager` → конструктор принимает kernel.
- [Х] **Фаза 10:** Удалить неиспользуемые `*Deps`, обновить реэкспорты, обновить `architecture.md`.

**Контрольная точка:** все тесты зелёные, код чистый, документация актуальна.

---

## Метрики успеха

- [ ] Все существующие тесты проходят без изменений хотя бы на уровне assertions
- [ ] Ни один пайплайн не принимает более 2 аргументов (node + опциональные данные)
- [ ] `nodeState.get(node)` нигде не вызывается напрямую — только через `kernel.nodes.getState(node)`
- [ ] `translate` / `notify` нигде не прокидываются аргументами — только через `kernel.services`
- [ ] Публичный API `ProxyStore` идентичен текущему (type-level backward compatibility)
- [ ] Новые unit-тесты на `NodeRegistry` (навигация по дереву, findByPath, getGroup)
