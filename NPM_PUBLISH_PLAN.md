# План публикации пакета в npm под именем `palistor`

> Дата: 2026-07-01
> Стратегия: **dual-publish** — оставляем `@projectint/palistor` в GitHub Packages и
> дополнительно публикуем `palistor` в публичный npm-реестр.
> Версия: продолжаем сквозную нумерацию с текущей `0.0.24`.

---

## 1. Текущее состояние

- Имя в [package.json](package.json): `@projectint/palistor`, версия `0.0.24`.
- `publishConfig.registry` = `https://npm.pkg.github.com` — по умолчанию публикует в GitHub Packages.
- CI [.github/workflows/publish.yml](.github/workflows/publish.yml) публикует в GitHub Packages по релизу.
- Имя `@projectint/palistor` зашито в README, `.github/skills/palistor/SKILL.md`, RFC-доках и JSDoc-примерах.
- Имя `palistor` в npm **свободно** (реестр отдаёт 404) — можно занять.
- `npm whoami` → 401: текущий токен для `registry.npmjs.org` не авторизован → нужен вход/новый токен.

## 2. Ключевое ограничение dual-publish

В одном `package.json` только одно поле `name`. GitHub Packages требует scoped-имя
(`@projectint/…`), npm — хотим короткое `palistor`. Решение:

- **Каноническое имя в файле → `palistor`** (для npm, публикация по умолчанию).
- Для GitHub Packages имя **временно переопределяем** прямо перед публикацией:
  `npm pkg set name="@projectint/palistor"` (в CI-шаге, без коммита в основную ветку).

Следствие-caveat: у двух реестров разные имена импорта
(`import … from "palistor"` в npm против `"@projectint/palistor"` в GitHub).
Каноническим в документации делаем `palistor`, а scoped-имя упоминаем как альтернативу.

---

## 3. Пошаговый план

### Шаг 0. Авторизация в npm (обязательно, сейчас 401)

- Проверить/создать аккаунт на npmjs.com, при необходимости включить 2FA.
- Войти локально: `npm login` (или положить валидный granular-token в `~/.npmrc`
  для `//registry.npmjs.org/:_authToken=`).
- Проверка: `npm whoami --registry=https://registry.npmjs.org` должен вернуть логин.
- Для CI создать **Automation**-токен (npm → Access Tokens) и положить в секрет
  репозитория `NPM_TOKEN`.

### Шаг 1. Правки `package.json`

- `name`: `@projectint/palistor` → **`palistor`**.
- Убрать блок `publishConfig` (или заменить на явный npm-реестр), чтобы `npm publish`
  по умолчанию шёл в `registry.npmjs.org`:
  ```jsonc
  // было
  "publishConfig": { "registry": "https://npm.pkg.github.com" }
  // стало — либо удалить блок целиком, либо:
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org" }
  ```
  Для unscoped-пакета `access: public` необязателен (unscoped всегда публичный), но не мешает.
- Версию оставить `0.0.24` (npm-имя новое, коллизии нет).
- Проверить `repository.url` (уже корректный) и наличие `LICENSE`/`README.md`
  (npm включает их автоматически независимо от `files`).

### Шаг 2. Скрипты публикации для двух реестров

Добавить в `scripts` удобные команды (build уже вызывается через `prepublishOnly`):

```jsonc
"scripts": {
  "build": "tsc -p tsconfig.build.json",
  "test": "vitest run",
  "prepublishOnly": "npm run build",
  "publish:npm": "npm publish --registry=https://registry.npmjs.org",
  "publish:github": "npm pkg set name=@projectint/palistor && npm publish --registry=https://npm.pkg.github.com; npm pkg set name=palistor"
}
```

> `publish:github` временно ставит scoped-имя, публикует в GitHub и возвращает имя обратно.
> В CI лучше делать это без записи в рабочее дерево основной ветки (см. Шаг 6).

### Шаг 3. Обновить lock-файл и документацию

- `npm install` — обновит `name` в `package-lock.json`.
- README: раздел установки сделать `npm install palistor` каноническим,
  scoped-вариант `@projectint/palistor` оставить примечанием «для GitHub Packages».
- Обновить примеры импорта в:
  - [README.md](README.md)
  - [.github/skills/palistor/SKILL.md](.github/skills/palistor/SKILL.md)
  - JSDoc в [store/store/types.ts](store/store/types.ts), [react/useStoreContext.ts](react/useStoreContext.ts)
  - RFC-доки [PROPOSAL_DEFINE_FLOW_RFC_V2.md](PROPOSAL_DEFINE_FLOW_RFC_V2.md) (по желанию).

### Шаг 4. Локальная проверка перед первой публикацией

```bash
npm run build                        # собрать dist
npm test                             # прогнать тесты
npm pack --dry-run                   # посмотреть, что реально попадёт в тарбол
npm publish --dry-run --registry=https://registry.npmjs.org
```

Проверить в выводе `npm pack`, что попадает только `dist/`, `package.json`,
`README.md`, `LICENSE` — и нет лишних файлов (`.md`-RFC, `node_modules` и т.п.).
При необходимости добавить `.npmignore` или уточнить поле `files`.

### Шаг 5. Первая публикация в npm вручную

```bash
npm publish --registry=https://registry.npmjs.org
# при включённой 2FA добавить: --otp=XXXXXX
```

Проверка: `npm view palistor version` → `0.0.24`; страница `https://www.npmjs.com/package/palistor`.

### Шаг 6. CI: добавить publish в npm, сохранить GitHub Packages

Отредактировать/дополнить [.github/workflows/publish.yml](.github/workflows/publish.yml) —
две job'ы по одному релизу.

```yaml
name: Publish
on:
  release:
    types: [published]

jobs:
  publish-npm:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write        # для npm provenance (опционально)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://registry.npmjs.org"
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish --provenance --access public   # provenance опционально
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-github:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://npm.pkg.github.com"
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm pkg set name=@projectint/palistor   # scoped-имя только в CI-раннере
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 4. Чеклист выполнения

- [ ] Есть аккаунт npm, включена 2FA, `npm whoami` работает.
- [ ] Создан `NPM_TOKEN` (Automation) и добавлен в секреты репозитория.
- [ ] `name` → `palistor`, `publishConfig` поправлен/удалён.
- [ ] Обновлён `package-lock.json` (`npm install`).
- [ ] Обновлены README/SKILL/JSDoc-импорты на `palistor`.
- [ ] `npm pack --dry-run` — состав тарбола корректен.
- [ ] `npm publish --dry-run` прошёл без ошибок.
- [ ] Первая публикация `palistor@0.0.24` в npm выполнена и видна в реестре.
- [ ] CI-workflow публикует в оба реестра по релизу.
- [ ] Проверена установка `npm install palistor` в чистом проекте.

## 5. Риски и откат

- **Имя `palistor` занято другим** — на момент проверки свободно; заняли — не откатить,
  но конфликт исключён после первой публикации.
- **Опубликовали не то содержимое** — npm запрещает переиздание той же версии;
  выпустить патч (`0.0.25`). `npm unpublish` доступен только в первые 72 часа и не рекомендуется.
- **Расхождение имён импорта** между npm (`palistor`) и GitHub (`@projectint/palistor`) —
  задокументировать; каноническим считать `palistor`.
- **2FA/OTP** может блокировать неинтерактивную публикацию — для CI использовать
  Automation-токен (обходит OTP), локально передавать `--otp`.

## 6. Что НЕ требуется менять

- Внутренние импорты в коде — относительные, от переименования не зависят.
- `dist` в `.gitignore` — ок: npm включает `dist` через поле `files`, а `prepublishOnly` его собирает.
- Существующий GitHub-релизный флоу по сути сохраняется (только добавляется `npm pkg set name`).
