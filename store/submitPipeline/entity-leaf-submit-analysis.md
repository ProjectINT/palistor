# Проблема: `f.billing_visible.submit()` — submit is not a function

## Что происходит

В `UserFormUI` вызывается:
```tsx
const f = useForm(form); // form = useForm(entityProxy, (s) => s.usersPage.editUser)
f.billing_visible.value = value;
f.billing_visible.submit(); // ← TypeError: submit is not a function
```

## Почему тест работает

Тест `leafCallbacks.react.test.tsx` тестирует **обычный режим** (не entity):
```tsx
const store = new Palistor({ config: { isActive: { value: false, onSubmit: spy } } });
const form = useForm(store);
form.isActive.submit(); // → buildProxy.ts → kernel.submitPipeline.execute(node)
```

В `buildProxy.ts` (строка ~120):
```ts
if (key === "submit") {
  return getCached(caches.submit, node, () => () => kernel.submitPipeline.execute(node));
}
```

Здесь `node` — это **config node** из дерева конфига. У него:
- `nodeState.get(node)` → хранит текущее значение (`value`)
- `node.onSubmit` → callback из конфига
- `kernel.nodes.nodeParents.get(node)` → родительская группа
- `kernel.nodes.proxyCache.get(parentNode)` → proxy родителя (передаётся как `parent` в `onSubmit`)

## Почему в entity-режиме не работает

`buildEntityLeafProxy` вообще не обрабатывает ключ `"submit"` — его нет в switch/case, поэтому возвращается `undefined`.

## Почему нельзя просто вызвать `submitPipeline.execute(node)`

`SubmitPipeline.execute(node: AnyConfigNode)` работает с ОДНИМ узлом. В entity-режиме данные размазаны по двум объектам:

| Что нужно pipeline | Где в entity-режиме | Где в обычном режиме |
|---|---|---|
| текущее значение (`nodeState.get(node).value`) | `entityLeaf` — в nodeState | тот же `node` |
| callback `onSubmit` | `templateField` — на конфиг-ноде | тот же `node` |
| callback `beforeSubmit` | `templateField` | тот же `node` |
| callback `afterSubmit` | `templateField` | тот же `node` |
| callback `validate` | `templateField` | тот же `node` |
| `submitting` flag | `entityLeaf` nodeState? или entityStates? | `nodeState.get(node)` |
| parent proxy | entity projection proxy | `proxyCache.get(nodeParents.get(node))` |
| nodePaths (для ошибок) | entityLeaf не зарегистрирован в nodePaths | `nodePaths.get(node)` |

### Проблема двойственности

- `submitPipeline.execute(templateField)` → прочитает value из nodeState **шаблона** (начальное значение шаблона, не entity), submitting поставит на шаблон, parent найдёт как editUser группу
- `submitPipeline.execute(entityLeaf)` → прочитает value правильно, но НЕ найдёт `onSubmit` (он на templateField), НЕ найдёт parent в nodeParents (entityLeaf не зарегистрирован)

---

## Вопросы для решения

### Q1: Расширять `SubmitPipeline.execute` или создавать отдельный метод?

Варианты:
- **A)** Добавить перегрузку `execute(node, options?: { valueSource?, callbacks?, parent? })`
- **B)** Отдельный метод `executeForEntity(entityLeaf, templateField, parentProxy)`
- **C)** Объединить подход — `execute` определяет контекст (entity vs config) через маркер на ноде

### Q2: Откуда брать `submitting` флаг?

Сейчас entity-group submit использует `resolveManager.entityStates.get(entityId, templateNode).submitting`. Для leaf-поля:
- **A)** Хранить в `nodeState.get(entityLeaf).submitting` — как в обычном режиме
- **B)** Хранить в `entityStates` с ключом `(entityId, templateField)` — как group submit
- **C)** Другой механизм?

### Q3: Что передавать как `parent` в `onSubmit(value, store, parent)`?

В конфиге `editUser.billing_visible.onSubmit = updateVisibilitySubmit`:
```ts
// updateVisibilitySubmit ожидает:
async (value, store, parent) => {
  // parent.id — id entity
  // parent.account_id.value — соседнее поле
}
```

- **A)** Передавать entity projection proxy (весь entity через шаблон) — `parent.id`, `parent.name.value` работают
- **B)** Передавать root entity proxy
- **C)** Другое?

### Q4: Нужна ли реактивность `submitting` через notify?

В обычном режиме pipeline вызывает `kernel.recompute()` + `kernel.notifyChanged()` при изменении `submitting`. В entity-режиме:
- `notifyChanged(new Set([entityLeaf]))` — это вызовет ре-рендер через tracking proxy?
- EntityLeaf зарегистрирован в nodeState, но зарегистрирован ли он в notification hub?
- Или нужно нотифицировать через entityNode (весь entity)?

### Q5: `beforeSubmit` на листовом entity-поле — нужно ли?

`SubmitPipeline` для leaf вызывает:
```ts
if (typeof node.beforeSubmit === "function") {
  value = await node.beforeSubmit(value, parentValues);
}
```
В шаблоне `editUser.billing_visible` нет `beforeSubmit`. Но если добавят — откуда брать `parentValues`? Из entity values?
