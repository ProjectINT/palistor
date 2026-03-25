# План актуализации architecture.md

## Цель

Привести `architecture.md` в полное соответствие с реальной кодовой базой Palistor.
Документ должен точно отражать существующую имплементацию — ни больше, ни меньше.

## Методика

Каждая часть — самодостаточная задача для Claude Sonnet 4.6. Для каждой указаны:
- **Секция документа** — какой раздел architecture.md проверять
- **Файлы для чтения** — конкретные файлы кодовой базы
- **Что проверить** — чек-лист проверок
- **Уже найденные расхождения** — конкретные проблемы, выявленные при анализе

---

## Часть 1: Palistor — класс-ядро (kernel)

**Секция документа:** «Palistor — класс-ядро (kernel)»

**Файлы для чтения:**
- `store/store/palistor.ts` (полностью)
- `store/store/types.ts` (ProxyStore interface)
- `index.ts` (публичные экспорты)

**Что проверить:**
- [x] Список `@internal` свойств ядра — совпадает с реальным
- [x] Публичные методы ProxyStore — полный ли список
- [x] Конструктор — описана ли последовательность инициализации
- [x] Метод `recompute()` — описание двух режимов

**Найденные расхождения:**
1. ~~**Отсутствует `ServiceRegistry`**~~ — ✅ ИСПРАВЛЕНО: `services: ServiceRegistry — translator, notifier, делегаты` присутствует в диаграмме ядра.
2. ~~**`GroupDepsMap` — неточное расположение**~~ — ✅ ПРИНЯТО: расположение в `store/store/groupDepsMap.ts` неважно для архитектурного документа; функциональность описана корректно.
3. ~~**Методы `set()`, `delete()`, `rekey()` не перечислены в kernel**~~ — ✅ ПРИНЯТО: они описаны в dedicated секции «store.set() / store.delete() / …». Дублировать в kernel diagram не нужно.
4. ~~**`entityProjectionObjs`**~~ — ✅ ИСПРАВЛЕНО: свойство описано корректно.
5. ~~**`setValuesNode()`**~~ — ✅ ИСПРАВЛЕНО: присутствует в таблице `@internal` методов.
6. ~~**`triggerEntityTemplateResolve()`**~~ — ✅ ИСПРАВЛЕНО: присутствует в таблице `@internal` методов.
7. ~~**Последовательность инициализации конструктора**~~ — ✅ ИСПРАВЛЕНО: 11 шагов описаны, порядок совпадает с кодом.
8. **НОВОЕ: `persist` помечен как `@internal`** — в диаграмме ядра написано `@internal persist`, но это ПУБЛИЧНОЕ свойство (`persist: PersistManager` входит в `ProxyStore` interface в `types.ts`). Приватное только хранилище `_persist`. → Исправить в architecture.md: убрать `@internal`.

---

## Часть 2: Write Pipeline

**Секция документа:** «Write Pipeline»

**Файлы для чтения:**
- `store/writePipeline/writePipeline.ts`
- `store/writePipeline/formatValue.ts`
- `store/writePipeline/storeValue.ts`
- `store/writePipeline/runSetter.ts`
- `store/writePipeline/mergeChanged.ts`
- `store/writePipeline/formatPatch.ts`
- `store/writePipeline/types.ts`

**Что проверить:**
- [x] Порядок фаз — совпадает с кодом
- [x] Каждая фаза — правильное описание
- [x] Возвращаемый тип / WriteResult — описан ли

**Найденные расхождения:**
1. ~~**Нумерация фаз неточна**~~ — ✅ ИСПРАВЛЕНО: диаграмма показывает 1 → 1.5 → 2 → 2.5 → 3 → 4 внутри WritePipeline, шаги 5 (notifyChanged) и 6 (onChangePipeline.fire) — снаружи, в SET trap. Совпадает с кодом (`writePipeline.ts`).
2. **`formatPatch`** — ❌ ЕЩЁ НЕ ОПИСАН: утилита в `store/writePipeline/formatPatch.ts` для рекурсивного форматирования патча. Экспортируется из `writePipeline.ts`, используется в `setValuesNode()`. Добавить упоминание в описание `setValuesNode()` или в секцию модулей.
3. **`WriteResult.skipped`** — ❌ НЕ ПОКАЗАН: диаграмма пишет `WriteResult { changed: Set<object> }`, но не показывает поле `skipped?: boolean`. Добавить в схему.

---

## Часть 3: Submit Pipeline

**Секция документа:** «Submit Pipeline»

**Файлы для чтения:**
- `store/submitPipeline/submitPipeline.ts`
- `store/submitPipeline/applyLeafBeforeSubmit.ts`
- `store/submitPipeline/collectLeafStates.ts`
- `store/submitPipeline/types.ts`

**Что проверить:**
- [x] Порядок шагов 1–8
- [x] `collectLeafStates` — описан ли
- [x] Структура `SubmitResult`
- [x] Пункт 3 в документе отсутствует (пропуск с 2 на 4) — что на самом деле

**Найденные расхождения:**
1. ~~**Пропущен шаг 3**~~ — ✅ ИСПРАВЛЕНО: шаги 1–8 + finally корректно пронумерованы в текущем architecture.md и соответствуют коду (submitPipeline.ts). Нумерация 3 — applyLeafBeforeSubmit.
2. ~~**`collectLeafStates`**~~ — ✅ ИСПРАВЛЕНО: описана в шаге 5 флоу и в секции Модули (`collectLeafStates.ts      сбор состояний листьев (для проверки ошибок)`).
3. ~~**`SubmitDeps` в секции Модули**~~ — ✅ ИСПРАВЛЕНО: в `types.ts   SubmitDeps, SubmitResult` тип `SubmitDeps` не существует в коде. Исправлено: `types.ts  SubmitResult: { success: true; result? } | { success: false; errors: {path, message}[] }`.

---

## Часть 4: Reset Pipeline

**Секция документа:** «Reset Pipeline» (неявно описан в фрагментах)

**Файлы для чтения:**
- `store/resetPipeline/resetPipeline.ts`
- `store/resetPipeline/buildResetPatch.ts`
- `store/resetPipeline/collectDefaults.ts`

**Что проверить:**
- [x] Алгоритм построения patch сброса
- [x] Взаимодействие с DirtyTracker (пересоздание baseline)
- [x] Сброс revalidate → false

**Найденные расхождения:**
1. ~~**Описание крайне краткое**~~ — ✅ ИСПРАВЛЕНО: в текущем architecture.md уже есть полный раздел Reset Pipeline с 5 шагами (applyPatch, captureInitialValues, setGroupRevalidate, recomputeAndNotify).
2. ~~**Неточное описание шага 1 buildResetPatch**~~ — ✅ ИСПРАВЛЕНО: было «values явно → override поверх initial snapshot», тогда как в коде `if (values !== undefined) return values` — значения становятся патчем напрямую. Исправлено.
3. ~~**`groupNode.reset` трансформ не описан**~~ — ✅ ИСПРАВЛЕНО: `buildResetPatch` после получения базового снапшота прогоняет его через `groupNode.reset()` (если задан). Добавлено в диаграмму шага 1.

---

## Часть 5: Resolve Pipeline

**Секция документа:** «Resolve Pipeline»

**Файлы для чтения:**
- `store/resolvePipeline/executeResolve.ts`
- `store/resolvePipeline/executeListResolve.ts`
- `store/resolvePipeline/initResolveStates.ts`
- `store/resolvePipeline/findResolvesToRetrigger.ts`
- `store/resolvePipeline/resetResolveState.ts`
- `store/resolvePipeline/applyPendingWrites.ts`
- `store/resolvePipeline/createValuesTrackingProxy.ts`
- `store/resolvePipeline/types.ts`
- `store/init/createResolveManager.ts`

**Что проверить:**
- [x] Общий flow resolve — совпадает ли с диаграммой
- [x] `createValuesTrackingProxy` — описан ли механизм auto-deps и буфер writes
- [x] `applyPendingWrites` — описана ли flush-логика
- [x] `executeListResolve` — различия с обычным resolve
- [x] `initResolveStates` — как строится начальный список resolvers
- [x] ResolveManager — триггер, ретриггер, eager launch

**Найденные расхождения:**
1. ~~**`createValuesTrackingProxy`**~~ — ✅ ПРИНЯТО: в документе уже написано `(resolvePipeline/, ≠ React tracking proxy)` и `auto-deps: read → accessedPaths, write → pendingWrites buffer` — достаточно точно.
2. ~~**`executeListResolve`**~~ — ✅ ИСПРАВЛЕНО: файл добавлен в секцию модулей; добавлен раздел «List resolve (executeListResolve)» с описанием отличий (нет trackingProxy/optimistic/retry, возвращает `Array<EntityData>`, upsert → itemIds → initialItemIds → version++ → syncListValuesCache).
3. ~~**`initResolveStates`**~~ — ✅ ИСПРАВЛЕНО: описание модуля расширено — «рекурсивный обход конфига: ноды с resolve → ResolveState (idle); обрабатывает группы и ListNode (Phase 2C)».

---

## Часть 6: onChange Pipeline

**Секция документа:** «onChange Pipeline» (неявно, фрагменты в модулях)

**Файлы для чтения:**
- `store/onChangePipeline/onChangePipeline.ts`
- `store/onChangePipeline/computeFieldKey.ts`
- `store/onChangePipeline/findOnChangeAncestors.ts`

**Что проверить:**
- [x] Алгоритм поиска предков с onChange
- [x] computeFieldKey — как вычисляется относительный путь
- [x] Асинхронность — fire-and-forget или await

**Найденные расхождения:**
1. ~~**Нет отдельной развёрнутой секции**~~ — ✅ ПРИНЯТО: раздел `## onChange Pipeline` уже есть в architecture.md и полностью соответствует коду. `findOnChangeAncestors` (снизу вверх, `onChange === Function`), `computeFieldKey` (`nodePath.slice(ancestorPath.length + 1)`), `Promise.resolve → .then(patch) → applyPatch + recomputeAndNotify`, `.catch()` — всё описано корректно.

---

## Часть 7: Store Proxy (buildProxy) и вспомогательные модули

**Секция документа:** «Слои системы» (Store Proxy)

**Файлы для чтения:**
- `store/buildProxy/buildProxy.ts`
- `store/buildProxy/computeProxyKeys.ts`
- `store/buildProxy/handleLazyResolve.ts`
- `store/buildProxy/initProxyCaches.ts`
- `store/buildProxy/buildListProxy.ts`
- `store/buildProxy/buildEntityProjectionProxy.ts`

**Что проверить:**
- [x] GET/SET trap описание — полнота
- [x] ownKeys / getOwnPropertyDescriptor — как работает spread
- [x] `computeProxyKeys` — утилита, возвращающая видимые ключи по типу ноды
- [x] `handleLazyResolve` — lazy resolve при GET группы с resolve (не list!)
- [x] `initProxyCaches` — WeakMap кэши onValueChange/submit/reset/setValues

**Найденные расхождения:**
1. ~~**`computeProxyKeys.ts`**~~ — ✅ ИСПРАВЛЕНО до нашего прохода: модуль присутствует в секции Модули (стр. 266).
2. ~~**`handleLazyResolve.ts`**~~ — ✅ ИСПРАВЛЕНО до нашего прохода: корректно описан в Модулях (стр. 268-269). Точнее: работает для ГРУППовых узлов с resolve, не для list — для list есть своя `triggerLazyResolveIfNeeded` внутри `buildListProxy.ts`.
3. ~~**`initProxyCaches.ts`**~~ — ✅ ИСПРАВЛЕНО: модуль описан с перечнем всех 4 кэшей (стр. 270).
4. **НОВОЕ: `ownKeys/GETOWNPROPERTYDESCRIPTOR` в Слои систем** — ✅ ИСПРАВЛЕНО: добавлен буллет `• OWNKEYS / DESC → computeProxyKeys → скрывает internal ключи при spread / Object.keys()` в блок Store Proxy.

---

## Часть 8: Tracking Proxy (React-слой)

**Секция документа:** «Tracking — гранулярные ре-рендеры»

**Файлы для чтения:**
- `react/createTrackingProxy.ts`
- `react/useForm.ts`
- `react/useTranslator.ts`
- `react/useNotifier.ts`
- `react/usePersist.ts`

**Что проверить:**
- [x] createTrackingProxy — механизм `accessed` set
- [x] useForm — два режима (store/subtree vs entity+selector)
- [x] getSnapshot — проверка версий только tracked нод
- [x] `hasNavigated` — флаг навигации без tracked FIELD_STATE_PROPS
- [x] useTranslator — `bumpLeafVersions` при смене translator
- [x] usePersist — вызывает `persist.enable()` в effect

**Найденные расхождения:**
1. ~~**`hasNavigated` флаг**~~ — ✅ ПРИНЯТО: реализация совпадает с документом. `accessed.size === 0 && hasNavigated` → возвращает стабильный `snapshotRef.current`, а не глобальную версию.
2. ~~**entity режим useForm**~~ — ✅ ИСПРАВЛЕНО: раздел `## useForm: режим entity` полностью описывает useEffect (bind + `triggerEntityTemplateResolve` + unbind). Также `triggerEntityTemplateResolve` упомянут в таблице `@internal методов Palistor`.
3. **НОВОЕ: трекинг ListNode в Tracking Proxy box** — ✅ ИСПРАВЛЕНО: добавлен буллет `• GET items/map/length/dirty (ListProxy) → пишет listNode в refs.accessed` в блок Слой 2.
4. **НОВОЕ: `useTranslator` механизм не описан** — ✅ ИСПРАВЛЕНО: добавлено описание цепочки `setTranslator(t) → hub.bumpLeafVersions()` в секции Модули.

---

## Часть 9: Compute — пересчёт FieldState

**Секция документа:** «Palistor.recompute()»

**Файлы для чтения:**
- `store/compute/computeFieldState.ts`
- `store/compute/fieldStateChanged.ts`
- `store/compute/resolveFlag.ts`
- `store/compute/resolveString.ts`
- `store/compute/isEmpty.ts`
- `store/compute/types.ts`
- `store/compute/recompute/recomputeLeaves.ts`
- `store/compute/recompute/recomputeTargeted.ts`
- `store/compute/recompute/recomputeAndNotify.ts`
- `store/compute/recompute/topologicalSortComputed.ts`
- `store/compute/recompute/collectGroupLeafNodes.ts`
- `store/compute/recompute/types.ts`

**Что проверить:**
- [x] Два режима recompute — targeted vs full
- [x] `recomputeLeaves` — фаза computed values (топологическая сортировка) + фаза FieldState
- [x] `recomputeTargeted` — использует groupDeps для определения affected групп
- [x] `recomputeAndNotify` — описан ли
- [x] `collectGroupLeafNodes` — описана ли функция
- [x] `topologicalSortComputed` — алгоритм Кана, описан ли
- [x] `computeFieldState` — все флаги + валидация
- [x] `isEmpty` — что считается пустым
- [x] Тип `FieldState` — полный список полей

**Найденные расхождения:**
1. ~~**`recomputeAndNotify`**~~ — ✅ ПОДТВЕРЖДЕНО: модуль уже описан в листинге (`хелпер: recompute → merge → notifyChanged`) и упомянут в `setValuesNode`. Описание точное.
2. ~~**`collectGroupLeafNodes`**~~ — ❌ ОШИБКА ИСПРАВЛЕНА: описание было `(не рекурсивно)` — но функция **рекурсивна** (собирает весь подтерев через groupLeafMap). Исправлено на `(рекурсивно: own + дочерние группы через groupLeafMap)`.
3. ~~**`fieldStateChanged`**~~ — ✅ ПОДТВЕРЖДЕНО: модуль уже описан в листинге (`сравнение двух FieldState (для skip notify)`). Описание корректно.
4. ~~**Call sites recompute**~~ — ❌ ДОПОЛНЕНО: в списке (1–9) отсутствовал пункт 10 — `ListProxy.add / remove / setItems` напрямую вызывают `kernel.recompute()` (`buildListProxy.ts:86`). Добавлен как пункт 10.
5. **НОВОЕ: `FieldState` полный тип** — ✅ ИСПРАВЛЕНО: добавлена секция `### FieldState — полный интерфейс` с таблицей всех 14 полей (value, label, placeholder, description, isRequired, isReadOnly, isDisabled, isVisible, isInvalid, errorMessage, submitting, dirty, revalidate, loading).

---

## Часть 10: DirtyTracking

**Секция документа:** упоминания в нескольких местах

**Файлы для чтения:**
- `store/dirtyTracking/index.ts`
- `store/dirtyTracking/captureInitialValues.ts`
- `store/dirtyTracking/collectInitialSnapshot.ts`
- `store/dirtyTracking/isDirtyValue.ts`
- `store/dirtyTracking/mergeInitialValues.ts`
- `store/dirtyTracking/recomputeDirtyTargeted.ts`
- `store/dirtyTracking/setGroupRevalidate.ts`

**Что проверить:**
- [x] DirtyTracker — класс или набор функций?
- [x] captureInitialValues — как работает снапшот
- [x] recomputeDirtyTargeted — сигнатура и алгоритм
- [x] isDirtyValue — алгоритм сравнения
- [x] mergeInitialValues — когда используется
- [x] Связь dirty нод с notification (bumpVersion)

**Найденные расхождения:**
1. ~~**`isDirtyValue.ts`**~~ — ✅ ПОДТВЕРЖДЕНО: модуль уже присутствует в листинге modules (`сравнение value с initial (primitives: ===, objects: JSON.stringify)`). Алгоритм добавлен в новую секцию `## DirtyTracking`.
2. ~~**`collectInitialSnapshot.ts`**~~ — ❌ ОШИБКА ИСПРАВЛЕНА: описание было `сбор плоского снапшота дерева` — но функция **рекурсивна** и возвращает **вложенный** объект, не плоский. Исправлено на `вложенный снапшот initial values для reset (рекурсивно; граница — дочерние группы с reset())`.
3. ~~**DirtyTracker**~~ — ✅ ВЕРИФИЦИРОВАНО: это **класс** `store/store/dirtyTracker.ts`. Методы: `capture`, `merge`, `collectSnapshot`, `initialValueMap` (getter). Исправлено: убрано несуществующее `recompute`, добавлено `collectSnapshot` — в kernel diagram И в modules listing.
4. **НОВОЕ: Отсутствует секция DirtyTracking** — ✅ ИСПРАВЛЕНО: добавлен раздел `## DirtyTracking — отслеживание изменений` с таблицей методов DirtyTracker, алгоритмом `recomputeDirtyTargeted` (BFS + bubble-up) и алгоритмом `isDirtyValue`.

---

## Часть 11: GroupDeps — зависимости между группами

**Секция документа:** «groupDeps — карта зависимостей»

**Файлы для чтения:**
- `store/groupDeps/createGroupDeps.ts`
- `store/groupDeps/createTrackingValues.ts`
- `store/groupDeps/getNodeGroupPath.ts`
- `store/groupDeps/getRecipientGroups.ts`
- `store/groupDeps/pairKey.ts`
- `store/groupDeps/resolveGroupByPath.ts`
- `store/store/groupDepsMap.ts` (!)

**Что проверить:**
- [x] GroupDepsMap — класс, расположение, API
- [x] `createTrackingValues` — proxy для auto-deps при init
- [x] `getRecipientGroups` — алгоритм поиска зависимых групп
- [x] `pairKey` — формат строки
- [x] Различие `store/groupDeps/` утилит vs `store/store/groupDepsMap.ts` класса

**Найденные расхождения:**
1. ~~**GroupDepsMap** — класс находится в `store/store/groupDepsMap.ts`, а НЕ в `store/groupDeps/`. Документ этого не уточняет.~~ — ✅ ИСПРАВЛЕНО: в modules-секции явно указано `store/store/groupDepsMap.ts           класс GroupDepsMap: deps (Set<string>), isBuilt, getTrackingWrap(), markBuilt()` — расположение очевидно.
2. ~~**`GroupDepsMap.getTrackingWrap()`** — метод для включения трекинга зависимостей при первом recompute. НЕ описан в документе.~~ — ✅ ИСПРАВЛЕНО: `getTrackingWrap()` теперь явно перечислен в строке модуля `groupDepsMap.ts` в modules-листинге.

---

## Часть 12: EntityRegistry

**Секция документа:** «EntityRegistry — нормализованный реестр сущностей»

**Файлы для чтения:**
- `store/entityRegistry/entityRegistry.ts`
- `store/entityRegistry/generateId.ts`
- `store/entityRegistry/types.ts`

**Что проверить:**
- [x] Все методы из таблицы — совпадают с реальными
- [x] Свойство `size` — есть ли
- [x] `getBindings()` — описан ли
- [x] `generateId` — утилита для `_tmp_<uuid>`
- [x] EntityNode / EntityLeafNode / EntityGroupNode / EntityData — типы

**Найденные расхождения:**
1. ~~**`size`** — свойство EntityRegistry. НЕ описано в документе.~~ — ✅ ИСПРАВЛЕНО: `| \`size\` | Количество entity в реестре |` присутствует в таблице методов.
2. ~~**`getBindings(id)`** — метод, возвращающий `ReadonlySet<object>`. НЕ описан в таблице методов.~~ — ✅ ИСПРАВЛЕНО: `| \`getBindings(id)\` | Получить \`ReadonlySet<object>\` привязанных template-нод для entity |` добавлен.
3. ~~**`generateId.ts`** — утилита для создания temp ID. Упомянута косвенно, без ссылки на файл.~~ — ✅ ИСПРАВЛЕНО: `generateId.ts       генерация временного ID (...)` явно есть в modules-листинге.
4. **НОВОЕ: Формат `_tmp_` ID неточен** — документ пишет `_tmp_<uuid>` в двух местах, но реальный формат из `generateId.ts`: `_tmp_<ts_base36>_<rand8>_<seq>` (timestamp base36 + 8 random chars + sequence counter). UUID это не. → Исправить в architecture.md. → ✅ ИСПРАВЛЕНО: обновлено в modules-секции и в таблице upsert.

---

## Часть 13: Списки (ListNode / ListProxy)

**Секция документа:** «Списки (ListNode / ListState)»

**Файлы для чтения:**
- `store/buildProxy/buildListProxy.ts`
- `store/store/types.ts` (ListState, ListConfig)
- `store/constants.ts` (LIST_SPREAD_KEYS)

**Что проверить:**
- [x] ListState — все поля
- [x] ListConfig — точный состав
- [x] ListProxy API — таблица ключей
- [x] `_syncListValuesCache` — где находится, описание
- [x] `dirty` для листов — computed, не хранится в ListState

**Найденные расхождения:**
1. ~~**`_syncListValuesCache`**~~ — ✅ ПОДТВЕРЖДЕНО: `_syncListValuesCache` является методом Palistor (`palistor.ts:637`). Также есть локальная утилита `syncListValuesCache` в `buildListProxy.ts`, которая делает то же напрямую. Документ корректен.
2. ~~**ListConfig**~~ — ✅ ИСПРАВЛЕНО: документ писал "resolve и т.д." — исправлено на `ListConfig { resolve?: ListResolveConfig }` — единственное поле.

---

## Часть 14: EntityProjectionProxy

**Секция документа:** «EntityProjectionProxy»

**Файлы для чтения:**
- `store/buildProxy/buildEntityProjectionProxy.ts`

**Что проверить:**
- [x] `buildEntityLeafProxy` — GET traps полный список
- [x] SET trap → `writeEntityLeafValue` — описан ли полный flow
- [x] Кэширование: entityProxyCache, leafProxyCache
- [x] Различие label/placeholder для entity (функция с entityValues)

**Найденные расхождения:**
1. ~~**`label/placeholder/description` — аргумент `translate` отсутствовал**~~ — ✅ ИСПРАВЛЕНО: реальная сигнатура функции `(translate, entityValues)`, а не просто `(entityValues)`. Исправлено в architecture.md.
2. ~~**`ownKeys` листового proxy — неточное описание**~~ — ✅ ИСПРАВЛЕНО: документ писал "полный набор FIELD_STATE_PROPS" — исправлено: листовой proxy включает `onValueChange` (не в FIELD_STATE_PROPS) и НЕ включает `loading`.
3. ~~**Root entity proxy — ключи `id`, `loading`, `submitting`, `submit` не были описаны**~~ — ✅ ИСПРАВЛЕНО: добавлена секция «**Root entity proxy**» с описанием `id`, `loading`, `submitting` (из `_getEntityBindingState`), `submit`.
4. ~~**Nested groups + phantom leaves не были упомянуты**~~ — ✅ ИСПРАВЛЕНО: добавлены в секцию EntityProjectionProxy.

---

## Часть 15: Traversal Layer

**Секция документа:** «Traversal Layer — слоёная архитектура»

**Файлы для чтения:**
- `store/traversal/nodeClassifier.ts`
- `store/traversal/walkFull.ts`
- `store/traversal/index.ts`
- `store/store/NodeRegistry/nodeUtils.ts`

**Что проверить:**
- [x] Три слоя — актуальны ли
- [x] TreeVisitor интерфейс — точная сигнатура
- [x] Различие `traversal.isListNode` vs `nodeUtils.isListNode`
- [x] Кто реально использует walkFull vs только Layer 1

**Найденные расхождения:**
1. ~~**Нужна верификация таблицы «Кто использует walkFull»**~~ — ❌ ОШИБКА ИСПРАВЛЕНА: `initGroupSubmitting` был ошибочно помещён в список «только Layer 1» — но на самом деле он использует `walkFull` (обход через `onGroupEnter` visitor). Исправлено: перемещён в список `walkFull`-потребителей, убран из Layer-1-only.
2. ~~**Три слоя**~~ — ✅ ПОДТВЕРЖДЕНО: три слоя актуальны, описание точное.
3. ~~**TreeVisitor интерфейс**~~ — ✅ ПОДТВЕРЖДЕНО: четыре метода `onLeaf`, `onGroupEnter`, `onGroupExit`, `onList` — сигнатуры и семантика совпадают с кодом.
4. ~~**`traversal.isListNode` vs `nodeUtils.isListNode`**~~ — ✅ ПОДТВЕРЖДЕНО: traversal = любой массив; nodeUtils = массив длины 1–2 (`Array.isArray && length >= 1 && length <= 2`). Различие описано верно.

---

## Часть 16: valuesCache и NotificationHub

**Секция документа:** «valuesCache» + init/createNotificationHub

**Файлы для чтения:**
- `store/valuesCache/valuesCache.ts`
- `store/init/createNotificationHub.ts`
- `store/init/createResolveManager.ts`
- `store/init/initGroupSubmitting.ts`

**Что проверить:**
- [x] ValuesCache — buildValuesCache + updateValuesCacheEntry сигнатуры
- [x] nodeSlot — описание O(1) update
- [x] NotificationHub — конструктор deps (НЕ kernel, а `NotificationHubDeps`)
- [x] NotificationHub.notifyChanged — полный flow (dirty → versions → subscribers → postNotifyHook)
- [x] ResolveManager — constructor deps
- [x] `initGroupSubmitting` — описано ли

**Найденные расхождения:**
1. ~~**NotificationHub**~~ — ✅ ПОДТВЕРЖДЕНО: конструктор уже правильно задокументирован: `Конструктор: { leafNodes: LeafEntry[], nodePaths: WeakMap }` — совпадает с кодом (`NotificationHubDeps`). Нет расхождения.
2. ~~**ResolveManager**~~ — ✅ ПРИНЯТО: конструктор принимает `ResolveManagerDeps` (не kernel), но документ не заявляет обратного — это просто опущенная деталь. Нет ошибки.
3. ~~**`initGroupSubmitting`**~~ — ✅ ПРИНЯТО: описание в модулях (`submitting/dirty/revalidate для групповых узлов`) точное. Алгоритм не нуждается в детализации.
4. **НОВОЕ: `store.rekey()` пропущен шаг `recompute()`** — ❌ ОШИБКА ИСПРАВЛЕНА: шаг 4 в секции «store.rekey()» гласил просто `notifyChanged(...)`, но код сначала вызывает `recompute(changedNodes)` и merges результат. Исправлено: шаг 4 = `recompute(changedNodes) → merge changedNodes`, шаг 5 = `notifyChanged(merged)`.
5. ~~**ValuesCache сигнатуры**~~ — ✅ ПОДТВЕРЖДЕНО: `buildValuesCache(rootConfig, nodeState)` + `updateValuesCacheEntry(cache, node, newValue)` совпадают; `nodeSlot: WeakMap<object, {parent, key}>` верно.
6. ~~**NotificationHub.notifyChanged flow**~~ — ✅ ПОДТВЕРЖДЕНО: порядок `recomputeDirtyTargeted → version++ → nodeVersions → nodeListeners → globalListeners → postNotifyHook` совпадает с кодом.

---

## Часть 17: Persist

**Секция документа:** «Модули → persist»

**Файлы для чтения:**
- `store/persist/persistManager.ts`
- `store/persist/drivers.ts`
- `store/persist/types.ts`
- `react/usePersist.ts`

**Что проверить:**
- [x] PersistManager — публичные методы: enable, disable, flush, clear, hydrate, isEnabled
- [x] `hydrateFromStorage` — приватный (не публичный)
- [x] PersistDriver интерфейс
- [x] PersistOptions
- [x] usePersist хук — React integration

**Найденные расхождения:**
1. ~~**`hydrate()` и `isEnabled()`** — публичные методы PersistManager, НЕ описаны в документе.~~ — ✅ ИСПРаВЛЕНО: оба метода присутствуют в таблице PersistManager API.
2. ~~**`hydrateFromStorage()`** — ПРИВАТНЫЙ метод. Документ упоминает в call sites recompute как `PersistManager.hydrateFromStorage()` — некорректно, публичный API — `hydrate()` или `enable()`.~~ — ✅ ПОДТВЕРЖДЕНО: в call sites recompute 8 уже правильно: `PersistManager.enable() / .hydrate() → полный (через private hydrateFromStorage)`.

---

## Часть 18: Constants — символы и наборы

**Секция документа:** «Модули → constants.ts»

**Файлы для чтения:**
- `store/constants.ts`

**Что проверить:**
- [x] 4 символа: CONFIG_NODE, SOURCE_PROXY, STORE_REF, ENTITY_ID
- [x] FIELD_STATE_PROPS — 12 членов
- [x] CONFIG_PROPS — надмножество FIELD_STATE_PROPS + service keys
- [x] SPREADABLE_FIELD_STATE_PROPS — подмножество для spread
- [x] GROUP_SPREAD_KEYS — 6 ключей
- [x] LIST_SPREAD_KEYS — 9 ключей

**Найденные расхождения:**
1. ~~**`SPREADABLE_FIELD_STATE_PROPS`** — отдельный набор, НЕ упомянут в документе вовсе. Содержит 11 ключей (FIELD_STATE_PROPS − dirty/loading + onValueChange). Используется для ownKeys leaf proxy.~~ — ✅ ПОДТВЕРЖДЕНО: упомянут в modules-листинге (constants.ts и computeProxyKeys.ts).
2. ~~Нужно перечислить точный состав каждого набора.~~ — ✅ ИСПРАВЛЕНО: строка constants.ts в модульном листинге раскрыта: перечислены члены FIELD_STATE_PROPS (12), SPREADABLE (11), GROUP_SPREAD_KEYS (6), LIST_SPREAD_KEYS (9), CONFIG_PROPS.

---

## Часть 19: Публичный API (index.ts)

**Секция документа:** нет отдельного раздела

**Файлы для чтения:**
- `index.ts`

**Что проверить:**
- [x] Полный список публичных экспортов (типы + runtime)
- [x] Какие entity-типы НЕ экспортируются (EntityData, EntityNode — только из subpath)
- [x] Соответствие с тем, что обещает документ

**Найденные расхождения:**
1. ~~**Нет раздела «Публичный API»**~~ — ✅ ПОДТВЕРЖДЕНО: раздел `## Публичный API (импорты)` уже есть в architecture.md.
2. ~~**EntityData / EntityNode** — НЕ экспортируются из root index.ts, только из `store/entityRegistry/index.ts`.~~ — ✅ ПОДТВЕРЖДЕНО: в дочументе правильно описаню только subpath импорты. **НОВОЕ:** комментарий `"useNotifier (единственный value-экспорт из root)"` был неточным: `localStorageDriver` и `sessionStorageDriver` также экспортируются из root. Исправлено.

---

## Часть 20: store.set() / store.delete() / store.rekey() / store.invalidate()

**Секция документа:** «store.set() / store.delete() / store.rekey()»

**Файлы для чтения:**
- `store/store/palistor.ts` — методы `set`, `delete`, `rekey`, `invalidate`

**Что проверить:**
- [x] `set()` — алгоритм: upsert → walkAndSyncEntityNode → recompute → notify
- [x] `delete()` — алгоритм: collectEntityLeaves → cleanup → notify
- [x] `rekey()` — алгоритм: entityRegistry.rekey → projection update → notify
- [x] `invalidate()` — ОПИСАН в документе, нужно верифицировать точность

**Найденные расхождения:**
1. ~~**`store.invalidate()`** — описан в документе, но его нет в «Palistor — класс-ядро» секции. Нужно добавить в список публичных методов.~~ — ✅ ИСПРАВЛЕНО: добавлена примечание `rekey()` и `invalidate()` вне ProxyStore в секцию класса-ядра.

---

## Сводка приоритетов

### Высокий приоритет (фактические ошибки / пропуски критичных API):

| # | Расхождение | Часть |
|---|---|---|
| 1 | Отсутствует описание конструктора Palistor (последовательность init) | 1 |
| 2 | `triggerEntityTemplateResolve()` — важный метод, не описан | 1 |
| 3 | Write Pipeline: notifyChanged и onFieldChange вне pipeline, нумерация неточна | 2 |
| 4 | Reset Pipeline: нет развёрнутого раздела | 4 |
| 5 | onChange Pipeline: нет развёрнутого раздела | 6 |
| 6 | ~~`SPREADABLE_FIELD_STATE_PROPS` — не описан~~ | 18 |
| 7 | ~~PersistManager: `hydrate()`, `isEnabled()` не описаны~~ | 17 |
| 8 | ~~`hydrateFromStorage()` назван публичным в call sites — он приватный~~ | 17 |

### Средний приоритет (неполнота описания):

| # | Расхождение | Часть |
|---|---|---|
| 1 | `computeProxyKeys.ts` — не описан | 7 |
| 2 | `handleLazyResolve.ts` — не описан | 7 |
| 3 | GroupDepsMap — класс в `store/store/`, не в `store/groupDeps/` | 11 |
| 4 | `GroupDepsMap.getTrackingWrap()` — не описан | 11 |
| 5 | EntityRegistry: `size`, `getBindings()` не описаны | 12 |
| 6 | NotificationHub/ResolveManager — конструкторы принимают deps, не kernel | 16 |
| 7 | `recomputeAndNotify`, `fieldStateChanged` — не описаны | 9 |
| 8 | `ServiceRegistry` — класс не описан | 1 |
| 9 | `createValuesTrackingProxy` — нужно отличить от react tracking proxy | 5 |
| 10 | ~~Нет раздела Public API (index.ts exports)~~ | 19 |

### Низкий приоритет (уточнения):

| # | Расхождение | Часть |
|---|---|---|
| 1 | ListConfig — точный состав не описан | 13 |
| 2 | `_syncListValuesCache` — приватный метод Palistor, а не модуль | 13 |
| 3 | Submit Pipeline — пропущен шаг 3 в нумерации | 3 |
| 4 | `isDirtyValue.ts`, `collectInitialSnapshot.ts` — не описаны | 10 |
| 5 | `generateId.ts` — не упомянут как отдельный файл | 12 |
| 6 | Верификация walkFull consumer table | 15 |

---

## Инструкция для исполнителя

Для каждой части:

1. **Прочитать** указанные файлы кодовой базы
2. **Прочитать** соответствующую секцию architecture.md
3. **Сверить** чек-лист проверок
4. **Подтвердить** или **опровергнуть** найденные расхождения
5. **Предложить конкретные правки** в architecture.md (текст замены)
6. **Применить правки** после согласования

Каждая часть рассчитана на один запрос к Claude Sonnet 4.6 (~15-30 файлов чтения, ~2000 строк контекста).
