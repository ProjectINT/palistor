# TODO — Совместимость PaliStor с GenericFormProvider

Анализ gap'ов между текущей реализацией `ProxyStore` и функционалом `GenericFormProvider`.

---

## Что уже реализовано в PaliStor ✅

| Функционал | Где реализовано |
|---|---|
| Реактивное хранилище вне React | `store/store.ts` — `createProxyStore` |
| Вычисляемые свойства (isVisible, isRequired, isDisabled, isReadOnly) | `store/compute.ts` — `computeFieldState` |
| Вычисляемые label/placeholder/description (как функции от values) | `store/compute.ts` — `resolveString` |
| Валидация через `validate(value, values)` в конфиге | `store/compute.ts`, `store/writePipeline.ts` |
| Formatter — преобразование значения перед записью | `store/writePipeline.ts` — `formatValue` |
| Setter — сайд-эффект записи (патч зависимых полей) | `store/writePipeline.ts` — `runSetter` |
| Computed values (value как функция от values) | `store/recomputeAll.ts` — computed с топологической сортировкой |
| Пересчёт всех полей при изменении любого | `store/recomputeAll.ts` — `recomputeAll` |
| Персистенция (hydrate + auto-save) | `store/persist/persistManager.ts` |
| i18n через `setTranslator` / `useTranslator` | `store/store.ts`, `react/useTranslator.ts` |
| Точечная подписка (re-render только по прочитанным полям) | `react/useForm.ts` + `react/createTrackingProxy.ts` |
| `onValueChange` callback на каждом поле | `store/buildProxy.ts` |
| Spread-safe proxy (`{...proxy}` не утечёт validate/formatter) | `store/buildProxy.ts` — `ownKeys` + `getOwnPropertyDescriptor` |
| `componentProps` — дополнительные пропсы для UI-компонентов | `store/buildProxy.ts`, `store/store.ts` |
| `initialValues` при создании store | `store/store.ts` — `ProxyStoreOptions.initialValues` |
| `getValues()` — snapshot всех значений | `store/store.ts` |
| `dependencies` — граф зависимостей между computed-полями | `store/recomputeAll.ts` — топологическая сортировка |
| `usePersist` — React хук для persist | `react/usePersist.ts` |

---

## Чего не хватает 🔴

### 1. Submit pipeline

**В GenericFormProvider:** полный цикл `beforeSubmit → validate → onSubmit → afterSubmit` с флагами `submitting`, `dirty`, `showErrorsAfterSubmit`.

**В PaliStor:** отсутствует полностью. Store — чистое хранилище, submit-логики нет.

**Что нужно:**
- [X] `submit()` — метод формы с lifecycle hooks
- [X] `beforeSubmit(values) → values` — трансформация перед отправкой
- [X] `onSubmit(values) → result` — собственно отправка
- [X] `afterSubmit(result, reset) → void` — пост-обработка
- [X] Флаг `submitting` (boolean) с подпиской
- [X] Очистка persist после успешного submit

**Решение:** реализовать в `useForm` на уровне React (не в store), т.к. `onSubmit` — async колбэк из React-контекста. Store остаётся чистым хранилищем.

**Как это нужно сделать**
1. Наше хранилище состоит из узлов. Я хочу что бы эти функции:
  - `beforeSubmit`
  - `onSubmit`
  - `afterSubmit`
  - `submit`
  Были доступны для объявления на уровне узла. Например:
```ts
const config = {
  user: {
    name: {
      value: '',
      isRequired: true,
      beforeSubmit: (value) => value.trim(),
    },
    email: {
      value: '',
      isRequired: true,
      isDisabled: false,
      isVisible: (values) => values.user.name !== '',
      beforeSubmit: (value) => value.toLowerCase(),
    },
    onSubmit: async (values) => {
      // тут можно делать валидацию на уровне формы, 
      // или отправлять данные на сервер, или что угодно
      await api.submitUser(values.user);
      return { success: true };
    },
    afterSubmit: (result, reset) => {
      alert('Форма отправлена!');
      reset(); // сбросить форму после успешного submit
    },
    beforeSubmit: (values) => {
      // глобальная трансформация перед submit
      return {
        ...values,
        submittedAt: new Date().toISOString(),
      };
    },
    reset: (initialValues) => {
      return initialValues; // сброс к начальным значениям
    },
    onChange: ({ fieldKey, newValue, previousValue, allValues }) => {
      console.log(`Поле ${fieldKey} изменилось с ${previousValue} на ${newValue}`);
      // можно вернуть патч для мержа
      // Тут можно будет добавить ассинхронные экшены, которые будут выполняться по условию какому то,
      // это можно будет зпустить и вычислить.
      // !!! Также важно тут можно будет сетить поля, возвращенные отсюда поля
      // Нужно будет сетить в стору, это будет результат серверных вычислений.

      const response = await api.saveDraft(allValues); // сохранять черновик на сервере при каждом изменении

      return {
        ...response // Тут состояние которое вернул сервер.
      }
    },
    submitting: false, // флаг submitting

    /* !!! На будущее (Пока не делаем) !!! */
    userResolver: async (initialValues) => {
      await api.fetchUserData(initialValues).then((data) => {
        return {
          ...data // Тут состояние которое вернул сервер.
        }
    });
  },
  /* !!! На будущее (Пока не делаем) !!! */
  rootResolver: async (initialValues) => {
    await api.fetchNodeData(initialValues).then((data) => {
      return {
        ...data // Тут состояние которое вернул сервер.
      }
  });
  },
  // тут может быть вложенная нода
  vehicle: { ... }
  // тут может быть рутовый onSubmit

  /*
    Когда мы получаем форму, мы берем сначала рутовый конфиг, и хендлеры рутовые,
    что бы получить хендлеры user нужно:

    const store = useForm(config);

    store.onSubmit(...) - рутовый onSubmit

  
    что бы получить onSubmit для user:

    const userStore = useForm(store.user);
    userStore.onSubmit(...) - onSubmit для user


    Не хочется жестко определять поведение хендлеров, ясно что onSubmit будет вызываться при сабмите из реакта, т.е. кнопка сохранить будет вызывать store.submit().

    Нам не понадобится скорее всего из реакта запускать (это просто не имеет смысла)
      - afterSubmit
      - beforeSubmit

    Нам нужно будет вызывать из реакта:
      onSubmit
      reset (хотя reset может быть и внутри afterSubmit, но может быть нужно будет вызвать и отдельно)
  
    *** Забегая наперед, что бы понимать архитектуру, дальше на уровне ноды будет резольвер
    Мы будем перехватывать вызов например store.user
    и если там юзера нет, то будем дергать userResolver, который будет заполнять
    юзера данными, которые придут с сервера, и после этого возвращать уже заполненный store.user
    и автоматически будет включать все что нужно для работы, типа dirty, initialValues и т.д. И это будет работать для любой ноды, не только для user, для vehicle тоже самое, и для рутового конфига тоже самое. И это будет работать из коробки, без дополнительного кода.


    Общий принцип в том, что наличие функции в конфиге определяет поведение узла, и поведение хранилища.
  */

};
```
---

### 2. Флаг `dirty` (форма изменена)

**В GenericFormProvider:** `dirty = JSON.stringify(values) !== JSON.stringify(initialRef.current)`.

**В PaliStor:** отсутствует. Store не хранит «начальный snapshot» для сравнения.

**Что нужно:**
- [X] Хранить initial snapshot значений при создании / reset / hydrate
- [X] Вычислять `dirty` как сравнение текущих значений с initial snapshot
- [X] Подписка на изменение `dirty`
- [X] Per-field dirty (опционально) — `changedFields`

---

### 3. Ленивая валидация (showErrors после первого submit)

**В GenericFormProvider:** ошибки не показываются до первой попытки `submit`. После первого submit — live-валидация при каждом изменении.

**В PaliStor:** валидация запускается **сразу** при каждом `recomputeAll`. Нет концепции «показывать/скрывать ошибки».

**Что нужно:**
- [X] Режим валидации: `silent` (ошибки вычисляются, но не отображаются) vs `live` (ошибки видны)
- [X] Переключение режима при первом submit
- [X] `validateAll()` — принудительная валидация всех полей
- [X] Поле `isInvalid` в FieldState (= `error && showErrors`)

---

### 4. Reset формы

**В GenericFormProvider:** `reset(next?)` — сбрасывает к defaults + optional overrides, обновляет initialRef, очищает ошибки.

**В PaliStor:** реализовано. `resetPipeline.ts` + `store.ts` и `GroupProxyNode.reset()`.

**Что нужно:**
- [X] `reset(values?)` — сбросить все поля к defaults из конфига (или к переданным значениям)
- [X] При reset: обновить initial snapshot (dirty = false), очистить validation mode

---

### 5. Мерж `initial` данных (серверные данные)

**В GenericFormProvider:** `mergeState(defaults, persisted, initial)` — трёхсторонний мерж. При изменении `initial` (useEffect) — re-merge.

**В PaliStor:** только `initialValues` при создании store. Нет механизма «подлить» серверные данные позже.

**Что нужно:**
- [X] `setValues(patch)`
- [ ] Dirty-aware merge: не затирать поля, которые пользователь уже изменил
- [ ] Реакция на изменение `initial` (на уровне `useForm` hook)

---

### 6. `onChange` callback

**В GenericFormProvider:** `onChange({ fieldKey, newValue, previousValue, allValues })` — вызывается после каждого изменения. Может вернуть `Partial<V>` для мержа.

**В PaliStor:** реализовано. `onChange` объявляется в конфиге узла, обрабатывается в `onChangePipeline.ts`.

**Что нужно:**
- [X] Callback `onChange` в конфиге узла (реализовано на уровне store, что мощнее чем useForm options)
- [X] Передавать `{ fieldKey, newValue, previousValue, allValues }`
- [X] Мержить возвращённый `Partial<V>` обратно в store

**Решение:** реализовано в `onChangePipeline.ts` — fire-and-forget, поддерживает async и патч.

---

### 7. `getVisibleFields()` — список видимых полей

**В GenericFormProvider:** `getVisibleFields()` — рекурсивно обходит конфиг и возвращает flat-список видимых ключей (с dot-нотацией).

**В PaliStor:** отсутствует как отдельный метод. Видимость доступна per-field через `proxy.field.isVisible`.

**Что нужно:**
- [ ] `getVisibleFields(): string[]` — собрать все пути видимых полей
- [ ] Учёт каскадной видимости (если группа невидима, дочерние тоже)

---

### 8. `setValues` / bulk update

**В GenericFormProvider:** `setValuesBulk(nextValues, fieldName)` — обновляет несколько полей за раз с formatters, но без setters (чтобы избежать рекурсии).

**В PaliStor:** нет bulk-операции. Каждое `proxy.field.value = X` — отдельный write pipeline с полным recompute.

**Что нужно:**
- [X] `setValues(patch: Partial<Values>)` — bulk update с одним recompute
- [X] Batch нескольких записей — один `recomputeAll` и один `notify` в конце

---

### 9. `isInvalid` в FieldState

**В GenericFormProvider:** `isInvalid: !!(showErrorsAfterSubmit ? currentError : undefined)` — зависит от режима показа ошибок.

**В PaliStor:** `isInvalid: boolean | undefined` в FieldState. Поле `error` переименовано в `isInvalid`.

**Что нужно:**
- [X] Добавить `isInvalid` в `FieldState` и `FieldProxyNode`
- [X] `isInvalid` = `error && validationMode === 'live'`
- [X] Или управлять на уровне React-хука

---

### 10. `isRequired` со строковым сообщением

**В GenericFormProvider:** `isRequired` может быть `boolean | string | (values) => boolean | string`. Строка — это сообщение об ошибке обязательного поля.

**В PaliStor:** `isRequired` — `boolean | (values) => boolean`. Только флаг, без сообщения. Валидация пустых полей происходит через `validate`.

**Что нужно:**
- [ ] Расширить `isRequired` до `MaybeComputed<boolean | string>` — строка = сообщение (типы в `types.ts` ещё не обновлены)
- [X] При validate: если поле пустое и isRequired — использовать сообщение из isRequired (или дефолтное)

---

### 11. Форм-level API (registry множественных экземпляров)

**В GenericFormProvider:** один провайдер = один экземпляр формы. Разные формы — разные провайдеры.

**В PaliStor (architecture.md):** планируется `createForm(config)` → `useForm(id)` с registry по `type:id`. Один конфиг — множество экземпляров.

**Что нужно:**
- [ ] Registry stores по ключу `type:id`
- [ ] `createForm({ config, type, translateFunction })` — фабрика
- [ ] `useForm(id, options?)` — хук с подпиской + submit + onChange + initial merge
- [ ] Cleanup policy: когда удалять store из registry

---

## Приоритеты реализации

### P0 — Минимум для замены GenericFormProvider
1. **Reset** — `reset(values?)` на уровне store
2. **Bulk setValues** — `setValues(patch)` с одним recompute
3. **Submit pipeline** — в `useForm` hook
4. **Dirty flag** — initial snapshot + isDirty
5. **Lazy validation** — показ ошибок только после submit

### P1 — Полная совместимость
6. **Merge initial** — подливание серверных данных с dirty-check
7. **onChange callback** — в `useForm` hook
8. **getVisibleFields** — утилита на store или useForm
9. **isInvalid** — в proxy
10. **isRequired с сообщением** — расширение типа

### P2 — Архитектурные улучшения
11. **Registry + createForm** — множественные экземпляры формы
12. **Cleanup policy** — GC неиспользуемых stores

---

## Архитектурные решения

### Где реализовывать: store vs useForm?

| Функционал | Где | Почему |
|---|---|---|
| reset | **store** | Чистая операция над данными, не зависит от React |
| setValues (bulk) | **store** | Оптимизация write pipeline |
| dirty | **store** | Нужен initial snapshot, привязан к данным |
| getVisibleFields | **store** | Обход дерева конфига, нет React-зависимостей |
| submit pipeline | **useForm** | Async callbacks, React lifecycle |
| onChange callback | **useForm** | Async callbacks, React refs для стабильных ссылок |
| lazy validation | **store** (mode) + **useForm** (toggle) | Store хранит режим, useForm переключает при submit |
| isInvalid | **store** | Вычисляется из error + validationMode |
| merge initial | **useForm** | Реактивный `useEffect` на изменение initial prop |
| submitting flag | **useForm** | React state, UI concern |

### Совместимость API

PaliStor использует **proxy-подход** (доступ через dot notation), а GenericFormProvider — **getFieldProps(path)**.

Ключевое преимущество PaliStor: `proxy.passport.number.value` вместо `getFieldProps('passport.number')`. При этом spread `{...proxy.passport.number}` возвращает HeroUI-совместимые пропсы уже сейчас.

Для обратной совместимости можно добавить `getFieldProps(path)` как алиас, но это **не обязательно** — proxy API удобнее.

### Списки
Нужно отдельно хранить списки.
Списки это массивы групповых узлов.
Потенциально они описываются тем же набором полей.
список объявляется массивом:

```ts
const config = {
  users: [{
    name: {
      value: '',
      isRequired: true,
    },
    email: {
      value: '',
      isRequired: true,
      isDisabled: false,
      isVisible: (values) => values.user.name !== '',
    }
  }]
```

Идея в том, что внутри списков по сути лежат те же самые узлы,
это позволит при создании новой какой то сущности, мы сможем просто ссылку добавить в список. Так это делается в react-relay connections,
потом можно хранить разные версии списков, для фильтрации и т.д.