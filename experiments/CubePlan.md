# План доведения эксперимента Cube до экспериментального релиза

Дата: 2026-10-29. Исходная оценка идеи: [CubeExperiment.md](./CubeExperiment.md). Набросок (с 2026-10-29 перенесён в [cube/core/](../cube/core/)): [index.ts в 90d8e67](https://github.com/ProjectINT/palistor/blob/90d8e67/experiments/index.ts).

## Что решаем

Cube переписывает механизм Palistor (один рекурсивный примитив + автотрекинг через геттеры и ленивое мемо по версиям) при том же языке конфига и той же публичной поверхности. Пакет при этом живёт в проде: `palistor@0.0.32` стоит в корне palirent (`^0.0.32`, ~80 файлов импортов) и в saas-starter (`0.0.32`, 20 файлов). Поэтому план строится на трёх ограничениях.

1. `latest` на npm не двигается, пока Cube не пройдёт обкатку на обоих потребителях. Экспериментальная линия публикуется под отдельным dist-tag.
2. Ветка `main` продолжает получать фиксы и релизы `0.0.x` всё время эксперимента. Ветка `cube-architecture` не трогает `store/` и `react/`, поэтому слияние `main` в неё тривиально.
3. Критерий готовности один: потребитель ставит `palistor@cube`, и его код проходит tsc и тесты без правок (или с коротким задокументированным списком правок).

## Исходные цифры (baseline, зафиксировать в Фазе 0)

| Метрика | Сейчас |
|---|---|
| Исходники `store/` + `react/` + `index.ts` | 16 979 строк |
| Тесты | 26 499 строк, 98 файлов |
| Набросок Cube (ядро без фич) | 615 строк |
| `store/store/types.ts` (публичные типы) | 1 149 строк |
| Размер `dist` (gzip) | измерить после `npm run build` |

Самые объёмные модули, которые придётся переносить как фичи: `resolvePipeline` 2 336, `buildProxy` 1 891, `init` 1 677, `pagination` 1 483, `flow` 894, `persist` 613, `filtering` 613, `entityRegistry` 543. Из них `buildProxy`, `init`, `compute/recompute`, `groupDeps`, `traversal`, `valuesCache` целиком исчезают в Cube. Остальные остаются как модули вокруг ядра.

## Что реально используют потребители

Проверено grep'ом по palirent и saas-starter. Это и есть порядок приоритетов для Фазы 2.

| Символ или фича | Упоминаний | Вывод |
|---|---|---|
| `useForm` | 53 | ядро React-границы, точность ререндеров обязательна |
| `defineList`, `ListResolver`, `PalistorList` | 48 / 16 / 1 | списки и реестр — первая фича после ядра |
| `useTranslator`, `useNotifier`, `useStoreContext` | 14 / 8 / 11 | React-обвязка, переносится почти как есть |
| `PalistorRef`, `PalistorProxy`, `ConfigProxy`, `FieldProxyNode`, `TranslateFn` | 14 / 9 / 5 / 2 / 5 | публичные типы должны сохранить имена и форму |
| `resolver:` в конфигах, `retry` | 28 / 15 | resolve с retry и состоянием ошибки |
| `filters:` | 9 | фильтрация |
| `usePersist`, `localStorageDriver` | 1 / 1 | persist |
| `pagination:` | 2 | пагинация |
| `defineFlow`, `defineFieldMapping`, `optimisticResolver`, suspense | 0 | публичны, но потребителями не используются: переносятся последними |
| Spread узла в пропсы `{...form.email}` | 15 | геттеры на прототипе не сработают, нужен own-enumerable или proxy на границе |
| Subpath-импорты `palistor/react/useForm`, `/react/usePersist`, `/react/useTranslator`, `/store/store` | 8 / 1 / 3 / 2 | карта `exports` в package.json должна сохранить эти пути |

## Решения, которые принимаем сейчас

- **Версионирование.** Экспериментальная линия: `0.1.0-cube.1`, `0.1.0-cube.2`, … с dist-tag `cube`. Финал: `0.1.0` под `latest`. Диапазон `^0.0.32` у потребителей не матчит пререлизы с другим кортежем версии, `npm update` их не подтянет. Установка для пробы: `npm i palistor@cube`.
- **Раскладка на ветке.** Новое ядро живёт в `cube/`, старое `store/` + `react/` остаются нетронутыми как эталон до самого переключения. Это даёт параметризованные контракт-тесты по обеим реализациям и бесконфликтные merge из `main`.
- **Публичная поверхность не меняется.** Имена экспортов корневого `index.ts`, публичные типы из `store/store/types.ts`, subpath-экспорты в `package.json`. `CubeOf` из наброска выбрасывается, типы `ConfigProxy` и компания переиспользуются поверх класса.
- **Тесты как спецификация.** Существующие тесты делятся на контрактные (поведение через публичный API, переносятся) и механизменные (тестируют внутренности старого ядра, удаляются при переключении). Первичная разметка ниже.
- **Гейты.** Каждая фаза заканчивается проверяемым критерием. Провал гейта не трогает `main` и потребителей: ветка остаётся экспериментальной, выводы пишутся в CubeExperiment.md.

## Фаза 0. Инфраструктура ветки и публикации (2–3 дня)

Цель: экспериментальный релиз можно выпустить одной кнопкой и он физически не способен задеть `latest`.

1. **Перенос кода.** `experiments/index.ts` → `cube/core/` (Cube, ListCube, Memo, Registry, observe/track по отдельным файлам). `cube/index.ts` повторяет экспорты корневого `index.ts`, недостающее помечено `TODO` и бросает `NotImplemented`. `experiments/CubeExperiment.md` остаётся журналом решений: в него дописывается итог каждого гейта.
2. **Сборка и типы.** `tsconfig.build.json` включает `cube/**`. Добавить `"./cube"` в `exports` package.json, чтобы ранние пререлизы отдавали новое ядро по subpath, не трогая `"."`.
3. **Контракт-тесты через vitest projects.** В `vitest.config.ts` два проекта, `store` и `cube`, с одинаковыми тестовыми файлами в `cube/contract/**` и alias `@impl`: в проекте `store` он указывает на `./index.ts`, в проекте `cube` на `./cube/index.ts`. Контракт-тест импортирует `Palistor`, `useForm`, `defineList` из `@impl`. Запуск `vitest --project cube` показывает паритет по срезу, `vitest --project store` доказывает, что сам тест не сломан. В CI на ветке проект `cube` сначала `continue-on-error`, после Гейта 1 обязателен.
4. **CI.** В `test.yml` добавить `cube-architecture` в `push.branches`, иначе прямые пуши в ветку не проверяются (PR'ы проверяются уже сейчас).
5. **publish.yml: защита `latest`.** Сейчас `npm publish` без `--tag` ставит `latest` любой версии, включая пререлиз. Правка:

   ```yaml
   - name: Resolve dist-tag
     id: tag
     run: |
       VERSION=$(node -p "require('./package.json').version")
       if [[ "${{ github.event.release.prerelease }}" == "true" ]]; then
         [[ "$VERSION" == *-* ]] || { echo "pre-release must have a prerelease version, got $VERSION"; exit 1; }
         echo "tag=cube" >> "$GITHUB_OUTPUT"
       else
         [[ "$VERSION" != *-* ]] || { echo "release of prerelease version $VERSION must be marked pre-release"; exit 1; }
         echo "tag=latest" >> "$GITHUB_OUTPUT"
       fi
   - run: npm publish --provenance --access public --tag ${{ steps.tag.outputs.tag }}
   ```

   То же для job `publish-github`. Локальные скрипты `publish:npm` и `publish:github` получают `--tag cube` через аргумент, а не по умолчанию.
6. **Пробная публикация.** `0.1.0-cube.0`: содержимое `main` плюс `palistor/cube` с ядром как есть. GitHub pre-release с тега `v0.1.0-cube.0` на ветке. Проверить: `npm view palistor dist-tags` показывает `latest: 0.0.32`, `cube: 0.1.0-cube.0`; в корне palirent `npm i palistor@0.1.0-cube.0` ставится, `npm i palistor@latest` возвращает 0.0.32.
7. **Baseline.** Записать в CubeExperiment.md размер `dist` (gzip), число тестов, и два микробенча в `cube/bench/`: запись в форму на 500 полей с 50 вычисляемыми флагами; `setItems` на 1 000 строк и число ререндеров списка из 100 компонентов. Бенч гоняется на обеих реализациях через тот же alias.
8. **Уборка.** `store/__skill_verify_tmp.test.ts` отслеживается git'ом и называется временным: переименовать в `store/fieldMappingSkillExample.test.ts` или влить в `fieldMapping.test.tsx`. Это отдельный мелкий PR в `main`.

Гейт 0: пререлиз опубликован под `cube`, `latest` не изменился, CI на ветке зелёный, baseline записан.

**Статус на 2026-10-29.** Сделаны пункты 1–5 и 7, версия поднята до `0.1.0-cube.0`; итог и baseline в [CubeExperiment.md](./CubeExperiment.md). Отличия от текста выше:

- dist-tag в publish.yml выводится из версии (`0.1.0-cube.N` → `cube`, `1.0.0-rc.N` → `rc`), а не захардкожен как `cube`. Отдельная job `dist-tag` проверяет версию до обеих публикаций. Такой publish.yml безопасен и на `main`.
- `npm test` гоняет только проект `store`, проект `cube` вызывается через `npm run test:cube`. В CI добавлен `npm run typecheck:cube`: контракт-тесты типизированы против публичных типов через `cube/tsconfig.json` (`@impl` → `index.ts`).
- `publish:github` обёрнут в `sh -c`, иначе аргумент `-- --tag cube` уходил в последнюю команду (`npm pkg set`), а не в `npm publish`. Локальный npm 11 сам отказывается публиковать пререлиз без `--tag`, CI на Node 20 (npm 10) нет.
- Бенч-режим vitest не выполняет `beforeAll`: список монтируется в tinybench `setup` / `teardown`.

Не сделаны: пункт 6 (коммит, пуш, GitHub pre-release `v0.1.0-cube.0`) и пункт 8 (PR в `main`); оба ждут подтверждения.

## Фаза 1. Проверка гипотезы на ядре (1–2 недели)

Цель: ответить на вопрос из CubeExperiment.md: сколько строк ядра нужно, чтобы контрактные тесты ядра позеленели, и не хуже ли это по точности ререндеров и скорости.

Срез A, ядро без списков и resolve: write pipeline (formatter → setter → onChange), вычисляемые флаги и строки, validate и `revalidate`, submit, reset, dirty, `values` и `getValues`, межгрупповые зависимости видимости, `useForm` с точечным ререндером.

Контрактные файлы среза A (переносятся в `cube/contract/`, импорт из `@impl`):
`store/store/store.test.ts`, `integration.test.ts`, `computedRegistration.test.ts`; `writePipeline/writePipeline.test.ts`; `submitPipeline/submitPipeline.test.ts`, `leafCallbacks.react.test.tsx`; `resetPipeline/resetPipeline.test.ts`; `onChangePipeline/onChangePipeline.test.ts`; `dirtyTracking/dirtyTracking.test.ts`; `groupDeps/tests/crossGroupVisibility.test.ts`, `conditionalCrossGroupDep.test.ts`; `normalizeConfig.test.ts`; `react/useForm.test.tsx`.

Срез B, resolve на листе и группе: оптимистичный и реальный, ленивый старт, перезапуск по зависимостям, зависимости после `await`, retry, статус и ошибка, `reload`.
Файлы: `resolvePipeline/resolvePipeline.test.ts`, `asyncContextInFlight.test.ts`; `init/createResolveManager.phase4.test.ts`; `react/phase5.test.tsx` (жизненный цикл `field.loading`, `skipIfResolved`, `loading` в `ownKeys`).

Известные дыры наброска, которые закрываются в этой фазе (все из CubeExperiment.md плюс найденное при чтении кода):

- **React-граница.** Глобальный `current`, который ставится в хуке и живёт до следующего `useForm`, ловит чтения из компонентов без хука. Решение из CubeExperiment.md: тонкий tracking proxy только на границе `useForm`, с `ownKeys` и `getOwnPropertyDescriptor`, чтобы `{...form.email}` отдавал те же пропсы, что сейчас. Остальной системе Proxy не нужен.
- **Snapshot в `useSyncExternalStore`.** Сумма версий по растущему набору зависимостей может измениться между двумя вызовами `getSnapshot` в одном рендере, React на это ругается и уходит в переррендер. Снимок считать по набору, зафиксированному на момент подписки, и пересчитывать после commit. Проверяется `react/useForm.test.tsx`.
- **Зависимости resolve после `await`.** Передавать в резольвер `values`, привязанный к наблюдателю этого запуска (аналог `createContextTrackingProxy` на `defineProperty`), а не читать глобальный `current`.
- **Пространство имён детей.** Члены класса (`children`, `parent`, `root`, `key`, `version`, `config`, `t`, `walk`, `patch`, `bump`, `scope`, `registry`, `items`, `length`, …) не должны занимать имена детей конфига. В palirent есть группа-ребёнок `length` в `vehicleForm/parameters.config.ts`. Внутренности уносятся в приватные поля (`#`) или в отдельный объект-узел, зарезервированный набор замораживается равным сегодняшнему (`RESERVED` из наброска минус внутренние имена). Конструктор бросает понятную ошибку на коллизию, тест на это в контракте.
- **Утечки.** `ListCube.cache` и `Registry.views` не чистятся при `remove` и `setItems`; `root.resolving` держит все кубики с resolve навсегда, включая удалённые элементы списков. Нужна явная отвязка.
- **Типы.** `CubeOf` заменяется на существующие `ConfigProxy`, `FieldProxyNode`, `GroupProxyNode`, `PalistorRef`, `ExtractValues` из `store/store/types.ts`: они описывают поведение, а не Proxy, и консьюмеры импортируют их по именам.

Гейт 1 (go/no-go), фиксируется в CubeExperiment.md:

- Срезы A и B зелёные в проекте `cube`, без `skip` и без правок самих тестов, кроме импорта из `@impl`.
- Число ререндеров в React-тестах не больше, чем у `store`.
- Бенчи Фазы 0 не хуже `store` более чем на 20 %; `setItems` и запись в поле в пределах того же порядка.
- Строк ядра под срезы A и B заметно меньше эквивалента в `store/` (ориентир из CubeExperiment.md: механизм должен ужаться в разы; если выигрыш меньше двух раз, идея не оправдывает миграцию).

При no-go: ветка остаётся с пометкой «закрыто», `cube/` не попадает в пакет, выводы в CubeExperiment.md.

**Статус на 2026-10-29.** Фаза 1 сделана, Гейт 1 пройден (go); цифры и решения в [CubeExperiment.md](./CubeExperiment.md), раздел «Фаза 1». Отличия от текста выше:

- Контракт лежит в `cube/contract/sliceA/` и `sliceB/`. Из списка среза B не перенесены `init/createResolveManager.phase4.test.ts` и `react/phase5.test.tsx`: оба про per-entity field resolve и `useForm(entity, templateSelector)`, поверхность шага 2.1 — туда они и добавлены в таблице ниже. `writePipeline/writePipeline.test.ts` целиком механизменный (гоняет `store.writePipeline.execute`): заменён на `writeSkip.test.ts` с теми же правилами через публичный API. В смешанных файлах вырезаны блоки по внутренностям (`collectLeafStates`, `collectDefaults`, `OnChangePipeline.fire` и т. п.); прочие правки — только импорт из `@impl`. Дыры наброска закрыты контрактом `sketchHoles.test.tsx` (зелёный и на store).
- Публичный узел сделан без Proxy вообще (собственные геттеры по spread-ключам плюс прототип на конфиг), Proxy остался только в `useForm`. Зарезервированные имена детей заморожены равными тем, что proxy группы store отвечал до поиска ребёнка; `length` среди них нет.
- `store.test.ts` исключён из `typecheck:cube`: файл никогда не типизировался, проблема публичных типов, не контракта.
- CI: `npm run test:cube` обязателен с этого момента, `continue-on-error` снят.

## Фаза 2. Фичи-модули вокруг ядра (4–6 недель)

Порядок по использованию у потребителей. Каждый шаг: перенос контрактных тестов среза → зелёный `cube` → пререлиз `0.1.0-cube.N` → запись в журнал.

| Шаг | Что переносится | Контрактные тесты |
|---|---|---|
| 2.1 Списки и реестр | `defineList`, `ListResolver`, `set` / `delete` / `rekey` / `invalidate`, вложенные списки, представление одной записи через несколько шаблонов, dirty и `getValues` списков, ошибка resolve списка | `defineList*.test.ts`, `entityList{Dirty,GetValues,Mutations,Nested,Resolve}.test.ts`, `listAddReturn`, `setItemsDuplicates`, `listResolveError`, `entityRegistry/entityIntegration.test.ts`, `store/store/{deleteListConsistency,listNodeGuard,listStateInit}.test.ts`, `resolvePipeline/{listResolve,listResolveContext,entityTemplateResolve,executeEntityFieldResolve}.test.ts`, `init/createResolveManager.entityField.test.ts`, `init/createResolveManager.phase4.test.ts` и `react/phase5.test.tsx` (из среза B Фазы 1: per-entity field resolve), `submitPipeline/leafCallbacks.entity.react.test.tsx`, `react/{defineList.react,entity-list-field,entity-list-nested,listResolveError.react}.test.tsx`, `react/phase4.test.tsx` (уведомления по общему листу сущности) |
| 2.2 React-обвязка | `useTranslator`, `useNotifier`, `useStoreContext`, контекст стора на корне, i18n в `label` / `placeholder` / `description` | `store/store/context.test.ts`, react-тесты хуков внутри `useForm.test.tsx` |
| 2.3 Фильтрация | `filters:` блок, debounce, клиентская проекция | `filtering.test.ts`, `filteringExample.port.test.ts`, `react/filtering.react.test.tsx` |
| 2.4 Persist | драйверы, `usePersist`, гонки гидрации, persist списков | `persist/{persist,hydrationRaces}.test.ts`, `entityListPersist.test.ts` |
| 2.5 Пагинация | `paged` / `infinite` / `cursor`, кэш страниц, `maxPages`, вложенные списки, suspense списка | `pagination/*.test.ts` (3), `react/pagination.react.test.tsx` |
| 2.6 Field mapping | `defineFieldMapping`, нормализация в конструкторе | `fieldMapping.test.tsx`, `normalizeConfig.test.ts`, бывший `__skill_verify_tmp` |
| 2.7 Flows | `defineFlow` / `defineStep`, навигация, ветвление, persist шага | `flow/{defineFlow,flowNavigation}.test.ts` |
| 2.8 Suspense и retry на листе | то, что осталось из `resolvePipeline` | остаток `resolvePipeline/*` контрактных |

Замечания по шагам:

- Пагинация, persist и flow сейчас цепляются за внутренности (`ListState`, resolve manager, `groupDepsMap`). Их тесты переносятся целиком, код привязки переписывается. Ожидать, что строки в этих модулях почти не уменьшатся: это фичи, а не механизм.
- После 2.1 имеет смысл первая обкатка на palirent (см. Фазу 3) по срезу «формы и списки», не дожидаясь пагинации и flow: это покрывает 90 % импортов потребителей и рано вскрывает несовместимости.
- Параллельно `main` может получать фиксы. Еженедельно `git merge main` в `cube-architecture`. Если фикс в `store/` сопровождался тестом, тот же тест добавляется в контракт и либо проходит на `cube`, либо заводится задача.

Гейт 2: вся контрактная выборка зелёная в проекте `cube`; корневой `index.ts` на ветке и subpath-экспорты в `package.json` переключены на `cube/`; `app-demo` (собирает библиотеку из исходников через `@palistor/*`) работает локально на Cube; опубликован `0.1.0-cube.N` как drop-in.

## Фаза 3. Обкатка на потребителях (1–2 недели)

1. **Корень palirent.** Ветка в palirent, `npm i palistor@cube`, `tsc --noEmit`, `vitest run`, ручной прогон самых тяжёлых форм: Vehicles (21 файл импортов), Users (12), Onboarding, Customers (spread полей). Расхождения заводятся списком в CubeExperiment.md с пометкой «баг Cube» или «намеренное изменение».
2. **saas-starter.** Пин `0.0.32` → `0.1.0-cube.N`, те же проверки.
3. **Цикл.** Фикс на ветке → контрактный тест на расхождение → новый пререлиз. Каждый пререлиз получает GitHub pre-release с коротким changelog.
4. **Документ миграции.** Если список «намеренных изменений» не пуст, он становится разделом README «Migrating to 0.1».

Гейт 3: оба потребителя зелёные на `palistor@cube` без правок или с правками из документа миграции; список «баг Cube» пуст.

## Фаза 4. Переключение (1 неделя)

1. PR `cube-architecture` → `main`: удалить `store/` и `react/createTrackingProxy.ts` с их механизменными тестами; `cube/contract/` становится основной тестовой выборкой; vitest возвращается к одному проекту; `exports` в package.json указывают на новые файлы, старые subpath-пути сохранены как реэкспорты.
2. Документация: `architecture.md` переписывается с нуля (все 1 300 строк описывают старый kernel: NodeView, recompute, groupDeps, buildProxy); в README раздел «Concepts → How tracking works» и строка «Proxy API» в таблице фич (Proxy остаётся только на границе `useForm`); `.github/skills/palistor/SKILL.md` раздел «Architecture Overview»; `README.ru.md` синхронно.
3. Релиз `0.1.0` с обычного GitHub release → dist-tag `latest`. Тег `cube` переводится на `0.1.0` (`npm dist-tag add palistor@0.1.0 cube`) или удаляется.
4. Потребители: `^0.0.32` → `^0.1.0` в корне palirent и в saas-starter.
5. Если во время эксперимента понадобится хотфикс старой линии: он выпускается с `main` как `0.0.33` обычным путём, экспериментальная линия его не блокирует. После переключения линия `0.0.x` замораживается.

## Разметка существующих тестов

Первичная, по именам файлов. Уточняется при переносе каждого среза.

**Механизменные, удаляются при переключении (около 40 файлов):** `buildProxy/*` (4); `compute/recompute/tests/*` (7); `compute/tests/*` (5, из них `resolveFlag` / `resolveString` / `isEmpty` можно оставить, если хелперы переедут); `groupDeps/tests/*` кроме двух контрактных (7); `traversal/*` (2); `applyPatch` (1); `init/createNotificationHub` (1); `dirtyTracking/recomputeDirtyTargeted` (1); `store/store/{groupDepsMap,nodeRegistry}` (2); `resolvePipeline/{createContextTrackingProxy,deepEqual,getByPath,initResolveStates,entityResolveStateMap}` (5); `writePipeline/{formatPatch,formatValue,mergeChanged,runSetter,storeValue}` (5).

**Контрактные, переносятся (около 58 файлов):** всё остальное, распределено по срезам выше.

## Риски и как их видим заранее

| Риск | Сигнал | Ответ |
|---|---|---|
| Выигрыш в строках есть, а в точности ререндеров нет | `react/useForm.test.tsx` на `cube` насчитывает больше рендеров | tracking proxy на границе (решение уже принято), иначе no-go на Гейте 1 |
| `getSnapshot` нестабилен в одном рендере | предупреждение React в тестах, бесконечный ререндер | снимок по зафиксированному набору зависимостей |
| Резольверы потребителей читают `values` после `await` и теряют зависимости | `asyncContextInFlight.test.ts`, расхождение на формах palirent с `resolver:` (28 мест) | observer-bound values в Фазе 1 |
| Коллизия имён детей конфига с членами класса | ошибка конструктора на `parameters.config.ts` (`length`) | приватные внутренности, замороженный `RESERVED`, проверка в конструкторе |
| Утечки в долгоживущих списках | бенч `setItems` на 1 000 строк в цикле растёт по памяти | отвязка в `remove` / `setItems`, `WeakRef` не нужен, достаточно явной чистки |
| Пререлиз случайно уходит в `latest` | `npm view palistor dist-tags` | защита в publish.yml из Фазы 0, проверяется пробной публикацией |
| `main` уезжает вперёд, ветка отстаёт | конфликт при merge, красный контракт на `cube` | еженедельный merge, `store/` на ветке не редактируется |
| Пагинация и flow не ужимаются и тянут сроки | строки в `cube/modules/pagination` сопоставимы с текущими | это ожидаемо; гейт по строкам применяется только к ядру (Фаза 1) |

## Порядок первых шагов

1. Фаза 0, пункты 1–5: перенос в `cube/`, vitest projects, CI, publish.yml.
2. Пробный пререлиз `0.1.0-cube.0`, проверка dist-tags.
3. Перенос среза A в `cube/contract/`, зелёный на `store`, красный на `cube`.
4. Закрытие дыр наброска до зелёного среза A, потом срез B.
5. Гейт 1 и запись итога в CubeExperiment.md.
