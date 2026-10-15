

// Задача нужно сделать идею очень легковесной.
// В чем идея?
// 1. Кубик. Это минимальная еденица системы.

/*
  class Cube
    1. Кубик содержит в себе вложенные кубики:
      - массив кубиков
    2. Кубик несет информацию:
      - строка
      - число
      - символ
      - массив
      - объект
    3. Кубик несет поведение:
      - резольвер кубиков
        - оптимистичный
        - реальный
      - резольвер информации
        - оптимистичный
        - реальный
*/

// ─────────────────────────────────────────────────────────────────────────────
// НАБРОСОК. Palistor, пересобранный вокруг одного примитива — Cube — на классах
// и геттерах, без Proxy. Что из Palistor здесь воспроизведено:
//   • дерево конфига → дерево кубиков; лист / группа / список — один класс
//     (список — тонкий подкласс, который умеет делать детей из массива)
//   • value / onValueChange, formatter → setter → onChange (write pipeline)
//   • вычисляемые флаги и строки (isVisible, isRequired, label, …) с АВТО-трекингом
//     зависимостей — вместо groupDeps / dependencies / topologicalSort / recompute*
//   • validate + isRequired, revalidate после первого неудачного submit
//   • dirty, values (живой снимок со стабильной ссылкой), getValues (клон)
//   • submit (beforeSubmit → onSubmit → afterSubmit), reset, setValues
//   • resolve: оптимистичный + реальный, ленивый старт, перезапуск по зависимостям.
//     Один и тот же resolve резолвит либо информацию (лист), либо кубики (группа/список)
//   • списки поверх реестра сущностей: одна запись — много представлений
//   • подписки + useForm с точечным ререндером
// Сознательно НЕ здесь: pagination, filter/sort, flow, persist, fieldMapping, i18n,
// suspense, retry, notifier, context. Это модули вокруг ядра, а не само ядро.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef, useSyncExternalStore } from "react";

// ── Конфиг: тот же язык, что и в Palistor ────────────────────────────────────

type Values = Record<string, any>;
type Translate = (key: string) => string;
type MaybeFn<T> = T | ((values: Values, t: Translate) => T);

export interface Resolve {
  /** Реальный резольвер. Лист → значение, группа → патч значений, список → массив записей. */
  resolver: (values: Values, store: Cube) => unknown;
  /** Оптимистичный — синхронный плейсхолдер на время загрузки. Та же форма результата. */
  optimisticResolver?: (values: Values) => unknown;
  /** false → стартовать сразу при создании, true (по умолчанию) → при первом чтении. */
  lazy?: boolean;
}

export interface CubeConfig {
  /** Есть `value` → лист. Нет → группа. Массив `[template, opts?]` → список. */
  value?: unknown;
  label?: MaybeFn<string>;
  placeholder?: MaybeFn<string>;
  description?: MaybeFn<string>;
  isVisible?: MaybeFn<boolean>;
  isRequired?: MaybeFn<boolean>;
  isDisabled?: MaybeFn<boolean>;
  isReadOnly?: MaybeFn<boolean>;
  validate?: (value: any, values: Values, t: Translate) => string | false | undefined;
  formatter?: (raw: any, values: Values) => unknown;
  setter?: (value: any, values: Values, prev: any) => Values;
  beforeSubmit?: (payload: any, values: Values) => any;
  onSubmit?: (payload: any, store: Cube) => unknown;
  afterSubmit?: (result: unknown, actions: { reset(): void }) => unknown;
  onChange?: (info: {
    fieldKey: string;
    newValue: unknown;
    previousValue: unknown;
    allValues: Values;
  }) => Values | void | Promise<Values | void>;
  reset?: (defaults: Values) => Values;
  resolve?: Resolve;
  /** Всё остальное — вложенные кубики. */
  [child: string]: unknown;
}

const RESERVED = new Set<string>([
  "value", "label", "placeholder", "description",
  "isVisible", "isRequired", "isDisabled", "isReadOnly",
  "validate", "formatter", "setter", "beforeSubmit", "onSubmit", "afterSubmit",
  "onChange", "reset", "resolve", "componentProps", "types", "dependencies",
]);

const childKeys = (c: CubeConfig) =>
  Object.keys(c).filter((k) => !RESERVED.has(k) && typeof c[k] === "object" && c[k] !== null);

export type SubmitResult =
  | { success: true; result?: unknown }
  | { success: false; errors: Array<{ path: string; message: string }> };

// ── Реактивное ядро: ОДИН механизм на всё ────────────────────────────────────
// «Кто сейчас наблюдает» — глобальная переменная. Любой геттер кубика зовёт
// track(this). Этим покрываются сразу три вещи, под которые в Palistor живут
// четыре разных tracking-proxy плюс карты зависимостей групп:
//   1) вычисляемые флаги (isVisible: (v) => v.showAddress),
//   2) зависимости resolve,
//   3) какие кубики прочитал компонент в useForm.

interface Observer {
  deps: Set<Cube>;
}
let current: Observer | null = null;

const track = (c: Cube) => { current?.deps.add(c); };

function observe<T>(obs: Observer, fn: () => T): T {
  const prev = current;
  current = obs;
  try { return fn(); } finally { current = prev; }
}

/**
 * Ленивое мемо: пересчитывается, только если версия хотя бы одной зависимости
 * сдвинулась. Это и есть замена recompute / recomputeTargeted / groupDepsMap:
 * никто ничего не «пересчитывает по дереву», каждый геттер сам знает, устарел ли он.
 */
class Memo<T> {
  private deps = new Map<Cube, number>();
  private cached!: T;
  private valid = false;

  constructor(private readonly fn: () => T) {}

  get(): T {
    if (this.valid && [...this.deps].every(([c, v]) => c.version === v)) {
      this.deps.forEach((_, c) => track(c)); // пробрасываем зависимости наблюдателю выше
      return this.cached;
    }
    const obs: Observer = { deps: new Set() };
    this.cached = observe(obs, this.fn);
    this.deps = new Map([...obs.deps].map((c) => [c, c.version]));
    obs.deps.forEach(track);
    this.valid = true;
    return this.cached;
  }
}

// ── Реестр сущностей (живёт на корне) ────────────────────────────────────────
// id → запись. Одна запись может быть показана через несколько списков и
// шаблонов: кубики-представления просто читают/пишут одну и ту же запись,
// а при изменении бампаются все разом. Это замена EntityRegistry +
// entityProjectionObjs + buildEntityProjectionProxy.

class Registry {
  private rows = new Map<string, Values>();
  private views = new Map<string, Set<Cube>>();

  get(id: string) { return this.rows.get(id); }

  set(row: Values) {
    const id = String(row.id);
    this.rows.set(id, { ...this.rows.get(id), ...row });
    this.views.get(id)?.forEach((c) => c.bump());
  }

  bind(id: string, view: Cube) {
    let set = this.views.get(id);
    if (!set) this.views.set(id, (set = new Set()));
    set.add(view);
  }
}

// ── Cube ─────────────────────────────────────────────────────────────────────

const flag = (v: MaybeFn<boolean> | undefined, values: Values, t: Translate, dflt: boolean) =>
  v === undefined ? dflt : typeof v === "function" ? v(values, t) : v;

const str = (v: MaybeFn<string> | undefined, values: Values, t: Translate) =>
  typeof v === "function" ? v(values, t) : v;

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export class Cube {
  // ── 1. Вложенные кубики ──────────────────────────────────────────────────
  readonly children = new Map<string, Cube>();
  readonly parent: Cube | null;
  readonly root: Cube;
  readonly key: string;

  /**
   * Живой снимок значений поддерева. Стабильная ссылка, на каждого ребёнка —
   * геттер. Чтение values.email трекает только email — ровно то, ради чего в
   * Palistor существуют groupDeps + createValuesTrackingProxy. JSON.stringify
   * и spread через геттеры работают, так что объект можно отдавать в API как есть.
   */
  readonly values: Values = {};

  // ── 2. Информация ────────────────────────────────────────────────────────
  private _value: unknown;
  private _initial: unknown;
  /** Версия: растёт при любом изменении кубика ИЛИ его потомков (bump идёт вверх). */
  version = 0;

  // ── 3. Поведение ─────────────────────────────────────────────────────────
  private readonly memos = new Map<string, Memo<any>>();
  private _submitting = false;
  private _revalidate = false;
  private rs?: { status: "idle" | "pending" | "done" | "error"; error?: unknown; deps: Map<Cube, number> };

  // Сервисы корня (на остальных кубиках не используются — см. геттеры ниже).
  private readonly _registry?: Registry;
  private readonly _listeners?: Set<() => void>;
  private readonly _resolving?: Set<Cube>;
  t: Translate = (k) => k;

  /** Элемент списка: id записи в реестре, из которой читают/пишут его листья. */
  entityId?: string;

  constructor(readonly config: CubeConfig, parent: Cube | null = null, key = "") {
    this.parent = parent;
    this.root = parent ? parent.root : this;
    this.key = key;
    if (!parent) {
      this._registry = new Registry();
      this._listeners = new Set();
      this._resolving = new Set();
    }

    this._initial = this._value = typeof config.value === "function" ? undefined : config.value;

    // Дети становятся свойствами: form.address.city — без Proxy. Геттер, а не
    // значение, чтобы обращение к ребёнку будило ленивый resolve группы (как GET
    // в Palistor). Цена — те же зарезервированные имена (ребёнок `submit` невозможен).
    for (const k of childKeys(config)) {
      const sub = config[k] as CubeConfig | [CubeConfig, { resolve?: Resolve }?];
      const child = Array.isArray(sub)
        ? new ListCube(sub[0], sub[1]?.resolve, this, k)
        : new Cube(sub, this, k);
      this.children.set(k, child);
      Object.defineProperty(this, k, { enumerable: true, get: () => { this.touchResolve(); return child; } });
      Object.defineProperty(this.values, k, { enumerable: true, get: () => child.value });
    }

    if (config.resolve) {
      this.rs = { status: "idle", deps: new Map() };
      this.root.resolving.add(this);
      if (config.resolve.lazy === false) this.runResolve();
    }
  }

  get isLeaf() { return "value" in this.config; }
  get registry(): Registry { return this.root._registry!; }
  private get listeners() { return this.root._listeners!; }
  private get resolving() { return this.root._resolving!; }

  /** Область значений для validate/isVisible/…: ближайший элемент списка или корень. */
  get scope(): Cube {
    let c: Cube = this;
    while (c.parent && c.entityId === undefined) c = c.parent;
    return c;
  }

  // ── value: чтение ────────────────────────────────────────────────────────

  get value(): any {
    track(this);
    this.touchResolve();
    if (!this.isLeaf) return this.values;
    if (typeof this.config.value === "function") {
      // вычисляемый лист — просто ещё одно мемо, никаких dependencies/topo-sort
      return this.memo("value", () => (this.config.value as Function)(this.scope.values));
    }
    const row = this.row();
    return row ? row[this.key] : this._value;
  }

  /** Лист внутри элемента списка хранит значение не у себя, а в записи реестра. */
  private row(): Values | undefined {
    const id = this.scope.entityId;
    return id === undefined ? undefined : this.registry.get(id);
  }

  // ── value: запись (write pipeline Palistor один в один) ──────────────────

  set value(raw: unknown) { this.write(raw, false); }
  readonly onValueChange = (v: unknown) => { this.value = v; };

  private write(raw: unknown, silent: boolean) {
    const { formatter, setter } = this.config;
    const values = this.scope.values;
    const prev = this.isLeaf ? (this.row() ? this.row()![this.key] : this._value) : undefined;
    const next = !silent && formatter ? formatter(raw, values) : raw;        // 1. formatter
    if (Object.is(prev, next)) return;

    const row = this.row();
    if (row) { row[this.key] = next; this.registry.set(row); } else this._value = next; // 2. store
    this.bump();                                                               // 3. version++ вверх по дереву
    if (!silent && setter) this.parent?.patch(setter(next, values, prev), true); // 4. setter → патч соседям
    if (!silent) this.emitChange(this.key, next, prev);                        // 5. onChange по цепочке групп
    this.root.notify();                                                        // 6. подписчики (+ перезапуск resolve)
  }

  /** setValues: массовый патч без formatter/setter/onChange. */
  patch(values: Values | void, silent = true) {
    if (!values) return;
    for (const k in values) {
      const child = this.children.get(k);
      if (!child) continue;
      if (child.isLeaf) child.write(values[k], silent);
      else if (child instanceof ListCube) child.setItems(values[k]);
      else child.patch(values[k], silent);
    }
  }
  setValues(values: Values) { this.patch(values, true); }

  bump() {
    for (let c: Cube | null = this; c; c = c.parent) c.version++;
  }

  private emitChange(fieldKey: string, newValue: unknown, previousValue: unknown) {
    for (let g = this.parent; g; g = g.parent) {
      const r = g.config.onChange?.({ fieldKey, newValue, previousValue, allValues: g.values });
      if (r) Promise.resolve(r).then((p) => g.patch(p)); // fire-and-forget, как в Palistor
    }
  }

  // ── Вычисляемое состояние: каждый геттер — ленивое мемо с автотрекингом ──

  private memo<T>(name: string, fn: () => T): T {
    let m = this.memos.get(name);
    if (!m) this.memos.set(name, (m = new Memo(fn)));
    return m.get();
  }

  get isVisible()  { return this.memo("isVisible",  () => flag(this.config.isVisible,  this.scope.values, this.root.t, true)); }
  get isRequired() { return this.memo("isRequired", () => flag(this.config.isRequired, this.scope.values, this.root.t, false)); }
  get isDisabled() { return this.memo("isDisabled", () => flag(this.config.isDisabled, this.scope.values, this.root.t, false)); }
  get isReadOnly() { return this.memo("isReadOnly", () => flag(this.config.isReadOnly, this.scope.values, this.root.t, false)); }
  get label()       { return this.memo("label",       () => str(this.config.label,       this.scope.values, this.root.t)); }
  get placeholder() { return this.memo("placeholder", () => str(this.config.placeholder, this.scope.values, this.root.t)); }
  get description() { return this.memo("description", () => str(this.config.description, this.scope.values, this.root.t)); }

  /** Ошибка считается всегда (нужна submit'у), а ПОКАЗЫВАЕТСЯ после revalidate. */
  private get rawError(): string | undefined {
    return this.memo("rawError", () => {
      if (!this.isLeaf) {
        for (const c of this.children.values()) if (c.isVisible && c.rawError) return c.rawError;
        return undefined;
      }
      const v = this.value;
      if (this.isRequired && isEmpty(v)) return "required";
      const r = this.config.validate?.(v, this.scope.values, this.root.t);
      return r || undefined;
    });
  }

  get revalidate(): boolean {
    track(this);
    return this._revalidate || (this.parent?.revalidate ?? false);
  }
  get errorMessage() { return this.revalidate ? this.rawError : undefined; }
  get isInvalid()    { return this.revalidate ? this.rawError !== undefined : undefined; }

  get dirty(): boolean {
    track(this);
    if (this.isLeaf) return !Object.is(this.value, this._initial);
    for (const c of this.children.values()) if (c.dirty) return true;
    return false;
  }

  get submitting() { track(this); return this._submitting; }

  // ── submit / reset ───────────────────────────────────────────────────────

  async submit(): Promise<SubmitResult> {
    this._revalidate = true;
    this.bump();
    const errors = this.collectErrors();
    if (errors.length) { this.root.notify(); return { success: false, errors }; }

    this._submitting = true; this.bump(); this.root.notify();
    try {
      let payload = this.isLeaf ? this.value : this.getValues(true);
      if (this.config.beforeSubmit) payload = this.config.beforeSubmit(payload, this.scope.values);
      const result = await this.config.onSubmit?.(payload, this.root);
      await this.config.afterSubmit?.(result, { reset: () => this.reset() });
      return { success: true, result };
    } finally {
      this._submitting = false; this.bump(); this.root.notify();
    }
  }

  private collectErrors(path: string[] = []): Array<{ path: string; message: string }> {
    if (!this.isVisible) return [];
    if (this.isLeaf) return this.rawError ? [{ path: path.join("."), message: this.rawError }] : [];
    const out: Array<{ path: string; message: string }> = [];
    for (const [k, c] of this.children) out.push(...c.collectErrors([...path, k]));
    return out;
  }

  reset(values?: Values) {
    const defaults = values ?? (this.config.reset ? this.config.reset(this.defaults()) : this.defaults());
    this.walk((c) => { c._revalidate = false; c.rs && (c.rs.status = "idle"); });
    this.patch(defaults, true);
    this.walk((c) => { if (c.isLeaf) c._initial = c.value; }); // новая база для dirty
    this.root.notify();
  }

  private defaults(): Values {
    const out: Values = {};
    for (const [k, c] of this.children) out[k] = c.isLeaf ? c._initial : c.defaults();
    return out;
  }

  /** Отвязанный глубокий клон (store.getValues()). forSubmit → применяет beforeSubmit листьев. */
  getValues(forSubmit = false): Values {
    const out: Values = {};
    for (const [k, c] of this.children) {
      if (c.isLeaf) out[k] = forSubmit && c.config.beforeSubmit ? c.config.beforeSubmit(c.value, c.scope.values) : c.value;
      else if (c instanceof ListCube) out[k] = c.items.map((i) => i.getValues(forSubmit));
      else out[k] = c.getValues(forSubmit);
    }
    return out;
  }

  walk(fn: (c: Cube) => void) {
    fn(this);
    for (const c of this.children.values()) c.walk(fn);
  }

  // ── resolve: один механизм для информации и для кубиков ──────────────────
  // Лист → результат становится value. Группа → результат патчит детей.
  // Список → результат становится items (см. ListCube.apply).

  get loading() { track(this); this.touchResolve(); return this.rs?.status === "pending"; }
  get error()   { track(this); return this.rs?.error; }
  reload()      { if (this.rs) this.runResolve(); }

  /** Ленивый старт: первое чтение value/loading у кубика с resolve → запуск. */
  private touchResolve() {
    if (this.rs?.status === "idle" && this.config.resolve!.lazy !== false) this.runResolve();
  }

  private runResolve() {
    const { resolver, optimisticResolver } = this.config.resolve!;
    const rs = this.rs!;
    const obs: Observer = { deps: new Set() };
    rs.status = "pending"; // до оптимистичного apply: его запись не должна перезапустить нас через notify
    rs.error = undefined;

    // Оптимистичный — синхронно, прямо сейчас.
    if (optimisticResolver) this.apply(observe(obs, () => optimisticResolver(this.scope.values)), false);
    this.bump();
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(observe(obs, () => resolver(this.scope.values, this.root)));
    } catch (e) {
      pending = Promise.reject(e);
    }

    // Зависимости — всё, что резольвер прочитал до первого await. Для чтений
    // после await нужен values-объект, привязанный к obs, а не к `current` — это
    // ровно то, что делает createContextTrackingProxy, только на defineProperty.
    rs.deps = new Map([...obs.deps].map((c) => [c, c.version]));

    pending
      .then(
        (r) => { this.apply(r, true); rs.status = "done"; },
        (e) => { rs.error = e; rs.status = "error"; },
      )
      .finally(() => { this.bump(); this.root.notify(); });
  }

  /** Перезапуск resolve, если сдвинулась версия хотя бы одной зависимости. */
  private checkDeps() {
    const rs = this.rs;
    if (!rs || rs.status === "pending") return;
    for (const [c, v] of rs.deps) if (c.version !== v) { this.runResolve(); return; }
  }

  protected apply(result: unknown, captureInitial: boolean) {
    if (this.isLeaf) {
      this.write(result, true);
      if (captureInitial) this._initial = this.value;
    } else {
      this.patch(result as Values, true);
      if (captureInitial) this.walk((c) => { if (c.isLeaf) c._initial = c.value; });
    }
  }

  // ── Подписки (только корень) ─────────────────────────────────────────────

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  notify() {
    for (const c of this.resolving) c.checkDeps();
    this.listeners.forEach((fn) => fn());
  }
}

// ── Список: кубик, чьи дети делаются из массива по шаблону ──────────────────

export class ListCube extends Cube {
  private ids: string[] = [];
  private cache = new Map<string, Cube>(); // id → кубик-представление для ЭТОГО списка

  constructor(readonly template: CubeConfig, resolve: Resolve | undefined, parent: Cube, key: string) {
    super(resolve ? { resolve } : {}, parent, key);
  }

  get items(): Cube[] { track(this); this.loading; return this.ids.map((id) => this.item(id)); }
  get length() { return this.items.length; }
  map<T>(fn: (item: Cube, i: number) => T) { return this.items.map(fn); }
  getById(id: string) { return this.items.find((i) => i.entityId === id); }

  override get value() { return this.items.map((i) => i.values); }

  setItems(rows: Values[]) {
    for (const r of rows) this.registry.set(r);
    this.ids = rows.map((r) => String(r.id));
    this.bump();
    this.root.notify();
  }
  add(row: Values) { this.setItems([...this.ids.map((id) => this.registry.get(id)!), row]); }
  remove(id: string) { this.ids = this.ids.filter((x) => x !== id); this.bump(); this.root.notify(); }

  /** Та же запись реестра через другой шаблон — просто другой ListCube/Cube поверх того же id. */
  private item(id: string) {
    let c = this.cache.get(id);
    if (!c) {
      c = new Cube(this.template, this, id);
      c.entityId = id;
      this.registry.bind(id, c);
      this.cache.set(id, c);
    }
    return c;
  }

  protected override apply(result: unknown) {
    this.setItems(result as Values[]);
  }
}

// ── Типизация: та же идея, что ConfigProxy, но поверх класса ─────────────────

type Reserved = "value" | "label" | "placeholder" | "description" | "isVisible" | "isRequired"
  | "isDisabled" | "isReadOnly" | "validate" | "formatter" | "setter" | "beforeSubmit"
  | "onSubmit" | "afterSubmit" | "onChange" | "reset" | "resolve" | "componentProps" | "types";

export type CubeOf<C> = Cube & {
  [K in Exclude<keyof C, Reserved> as C[K] extends object ? K : never]:
    C[K] extends readonly [infer T, ...any[]] ? ListCube & { items: CubeOf<T>[] } : CubeOf<C[K]>;
};

export function createStore<C extends CubeConfig>(config: C): CubeOf<C> {
  return new Cube(config) as CubeOf<C>;
}

// ── React ────────────────────────────────────────────────────────────────────
// Единственное место, где Proxy действительно удобен: граница рендера компонента.
// Без Proxy «текущий наблюдатель» ставится в хуке и живёт до следующего useForm.
// Работает, потому что тело компонента выполняется синхронно до рендера детей.
// Слабое место: чтения из компонентов БЕЗ useForm попадут в набор последнего
// useForm → лишний ререндер (не баг, но и не точность Palistor). Если это
// окажется важным — тонкий tracking-proxy на 50 строк тут уместен, остальной
// системе он не нужен.

export function useForm<T extends Cube>(cube: T): T {
  const frame = useRef<Observer>({ deps: new Set() }).current;
  current = frame; // чтения кубиков до конца тела компонента попадут сюда

  const subscribe = useCallback((cb: () => void) => cube.root.subscribe(cb), [cube]);
  const snapshot = useCallback(() => {
    let s = 0;
    for (const c of frame.deps) s += c.version; // версии только растут → сумма монотонна
    return s;
  }, [frame]);

  useSyncExternalStore(subscribe, snapshot);
  return cube;
}

// ── Пример (тот же конфиг, что в README Palistor) ────────────────────────────

export const demo = createStore({
  showAddress: { value: false },
  email: { value: "", isRequired: true, validate: (v: string) => (!v.includes("@") && "Invalid email") },
  address: {
    isVisible: (v: Values) => v.showAddress,
    city: { value: "" },
    country: { value: "US" },
  },
  userInfo: {
    resolve: {
      resolver: async (v: Values) => ({ name: "User " + v.email }),
      optimisticResolver: () => ({ name: "Loading…" }),
    },
    name: { value: "" },
  },
  users: [
    { id: { value: "" }, name: { value: "", isRequired: true } },
    { resolve: { resolver: async () => [{ id: "1", name: "Ann" }, { id: "2", name: "Bob" }] } },
  ],
});

// demo.address.city.value = "Kyiv";
// demo.address.isVisible;       // false, пока showAddress = false
// demo.users.items[0].name;     // Cube — тот же реестр, что и у любого другого списка с id "1"
