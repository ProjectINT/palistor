# Таргетированный пересчёт — recompute-logic

## Проблема

Сейчас при **любом** `SET .value` вызывается `recomputeAll()`, который пересчитывает
**все** листья дерева: все computed values, все `computeFieldState` (isVisible, isRequired,
validate, label…). Для формы из 50 полей — это 50 вызовов `computeFieldState` + N вызовов 
computed + 2× `collectValues(rootConfig)`, хотя реально затронуты 3–5 полей.

---

## Текущая архитектура

### Структура дерева

```
rootConfig (группа)
├── email        (лист: value)
├── paymentType  (лист: value)
├── cardNumber   (лист: value, isVisible → paymentType)
├── passport     (группа, isVisible → paymentType)
│   ├── number     (лист: value)
│   ├── issueDate  (лист: value)
│   └── expiryDate (лист: value, deps → passport.issueDate)
├── country      (лист: value)
├── city         (лист: value, isVisible → country)
├── shippingCost (лист: computed value → country+city)
├── price        (лист: value)
├── quantity     (лист: value)
└── total        (лист: computed value → price+quantity)
```

Группа — это узел конфига **без** `value`. У группы есть дочерние узлы (листья и/или подгруппы).
В текущем демо-конфиге `passport` — единственная вложенная группа, остальные поля — прямые
потомки rootConfig.

### Ключевые хранилища

```
nodeState:    WeakMap<configNode, FieldState>  — значение + флаги каждого листа
nodePaths:    WeakMap<configNode, string>       — "passport.number", "country", ...
nodeParents:  WeakMap<configNode, configNode>   — child → parent
groupLeafMap: WeakMap<groupNode, LeafEntry[]>   — группа → её прямые листья
leafNodes:    LeafEntry[]                       — все листья плоским списком
```

### Write Pipeline (горячий путь)

```
proxy SET "value"
  └─ writeValue(node, rawValue, deps)
       ├─ formatValue()
       ├─ storeValue()          → nodeState.set(node, { ...state, value })
       ├─ runSetter()           → patch = setter(value, allValues)
       │                          applyPatch(rootConfig, nodeState, patch) → Set<changed>
       ├─ recomputeAll()        → пересчёт ВСЕХ → Set<changed>   ← ПРОБЛЕМА
       └─ mergeChanged()
```

### recomputeAll → recomputeGroup(rootConfig)

```
recomputeGroup(groupNode):
  leafNodes = collectGroupLeafNodes(groupNode)  // ВСЕ листья поддерева
  
  Фаза 1: computed values
    computedEntries = leafNodes.filter(typeof value === "function")
    sorted = topologicalSortComputed(computedEntries)
    for each sorted:
      allValues = collectValues(rootConfig)     // полный snapshot
      computedValue = node.value(allValues)
      if changed → update nodeState
  
  Фаза 2: computeFieldState
    allValues = collectValues(rootConfig)        // ещё один полный snapshot
    for each leafNode:
      computeFieldState(node, value, allValues)  // isVisible, isRequired, validate, label...
      if changed → update nodeState
```

---

## Целевая архитектура

### Принцип

При `SET .value` мы знаем **какой узел изменился** и **какие узлы затронул setter**.
Из этих изменённых путей мы можем определить **какие группы нужно пересчитать** —
через карту зависимостей, построенную при инициализации.

мы всегда просчитываем только те группы которые затронуты изменениями.
Не бывает так, что бы мы посчитали все состояние.
Мы строим Set зависимостей для группы:

Например группы:
А Б В
тогда по умолчанию у нас есть зависимости АА, ББ, ВВ

У нас есть 3 вида работы с полями:

Где первое значение это группы донор потока, а второе значение это группа реципиент потока.

Если в группе A мы ловим доступ к полю из группы Б, то мы добавляем зависимость БА (Б донор А)
Если в группе А мы ловим установку поля из группы В, то мы добавляем зависимость АБ (А донор В)

Если в группе Б мы ловим доступ к полю из группы В, то мы добавляем зависимость БВ

Если в группе В мы делаем изменения то
мы пересчитываем группу В, 


<!--
Еще раз, при инициализации, мы создаем карту зависимостей. Каким образом? Внутри set мы знаем какую группу устанавливаем. Внутри get мы знаем какую группу мы задели запросом, таким образом мы можем формировать пары груп, из которой и которую запрашиваем. Большенство пар будут иметь одинаковые ключи А-А С-С, иногда будет A-C или С-А. Эти пары мы храним в Set без дублей, когда обновляется какой то лист, мы находим какие группы нужно пересчитать и уже пересчитываем. dependencies можно использовать для оптимизации, если они есть, то не нужно считать всю группу, если нет то всю группу пересчитываем. Главное что уже не будем считать все состояние. Но то как ты это хочешь делать мне не нравится, этот способ сложный кажется. Попробуй упростить, сделать через Set как я тебе написал.
-->


Разработчик ставит `dependencies` на те поля которые хочет.

Если поле которое мы устанавливаем имеет явные зависимости то мы пересчитываем только эти зависимости в текущей группе.

Дальше мы в карте зависимостей групп смотрим, если какие то группы еще зависят от этой группы, то ту группу пересчитываем, если та группа является ресипиентом изменненной группы. Если она донор, то не нужно пересчитывать.

Следующим шагом, мы можем хранить более детальную карту зависимостей, когда мы создаем связи групп,
мы можем детализировать эту связь, это будет еще слой оптимизации, когда каждая группа в Карте зависимостей групп, будет еще иметь детализацию этих зависимостей, т.е.:

Группа А → Группа Б (зависимость АБ)
Следующий уровень детализации

{
  [поле1]: [поле2, поле3], // если изменится поле1 в группе А, то нужно пересчитать поле2 и поле3 в группе Б
  [поле4]: [поле5] // если изменится поле4 в группе А, то нужно пересчитать поле5 в группе Б
}
