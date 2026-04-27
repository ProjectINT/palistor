# Проблема: отсутствует guard для ListNode в `collectGroupComputeNodes`

## Файл

`store/compute/recompute/collectGroupComputeNodes.ts`

## Суть

В `collectGroupComputeNodes` нет проверки на массив (`Array.isArray`) при рекурсии по дочерним узлам. В итоге функция заходит внутрь ListNode-массивов и обрабатывает их template-узлы повторно.

**Как это происходит:**

1. В `registerNodes` строка `(child as any).__kind = hasChildren(child) ? "group" : "leaf"` выполняется **до** проверки `Array.isArray(child)`.
2. `hasChildren` вызывает `configKeys(array)`, который возвращает числовые ключи `["0", "1"]` (template + listConfig). Оба являются объектами → `hasChildren` возвращает `true`.
3. ListNode-массив получает `__kind = "group"`.
4. В `collectGroupComputeNodes` при обходе дочерних ключей родительской группы: `isLeafNode(array)` возвращает `false` (kind = "group") — guard не срабатывает, функция рекурсирует в массив.
5. `groupComputeMap.get(array)` — undefined (массив не регистрируется в карте), но `configKeys(array)` возвращает `["0"]`, что приводит к рекурсии в template-узел.
6. Template IS зарегистрирован в `groupComputeMap` через `registerNodes(template, ...)`, поэтому его compute-записи **дублируются** в результате.

```ts
// collectGroupComputeNodes.ts — проблемный участок
for (const key of configKeys(groupNode as Record<string, unknown>)) {
  const child = groupNode[key] as AnyConfigNode;

  if (!child || typeof child !== "object") continue;
  if (isLeafNode(child)) continue;
  // ← здесь нет: if (Array.isArray(child)) continue;
  result.push(...collectGroupComputeNodes(child, groupComputeMap));
}
```

## Последствия

- **Корректность**: не нарушается — двойная обработка одного узла в `recomputeLeaves` идемпотентна.
- **Производительность**: незначительные лишние вычисления на каждый полный recompute (один раз при старте и при invalidation всего дерева).
- **groupDepsMap**: при первом recompute с `trackingWrap` дублирование может привести к двойной регистрации зависимостей для template-узлов. Практического эффекта не замечено в тестах, но потенциально может вызвать лишние перерасчёты при изменениях в группах-донорах.

## Исправление

Добавить один guard в цикл рекурсии:

```ts
for (const key of configKeys(groupNode as Record<string, unknown>)) {
  const child = groupNode[key] as AnyConfigNode;

  if (!child || typeof child !== "object") continue;
  if (Array.isArray(child)) continue; // ListNode — пропустить
  if (isLeafNode(child)) continue;
  result.push(...collectGroupComputeNodes(child, groupComputeMap));
}
```

## Почему не исправлено сейчас

Решение отложено — поведение не вызывает видимых сбоев в текущих 919 тестах. Исправление внесут отдельно после оценки влияния на groupDepsMap в реальных сценариях с ListNode.
