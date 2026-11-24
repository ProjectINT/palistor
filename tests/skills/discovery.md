# Discovery prompts

Activation checks for the `description` of each skill: a prompt that should make an agent load the
skill, and an adjacent prompt that should not. Half of them deliberately avoid the library's API
vocabulary. Every prompt assumes a React project that already depends on `palistor`.

How to run: expose the skills through the normal consumer setup (README, "Agent Skills"), give a
fresh agent session one prompt, and record whether it actually loaded the skill's `SKILL.md` — a skill
name in the answer is not enough. Repeat ambiguous prompts. Keep the prompts below fixed when tuning
a description and test fresh phrasings separately.

**Status: not run.** These prompts were written with the skills on 2026-11-15 (`palistor-ssr`: on
2026-11-23, when the descriptions of `palistor` and `palistor-lists` also got a pointer to it; its
prompt 5 and the fourth "should not load" on 2026-11-24, with the app-wide store task;
`palistor-lists` prompts 4–6 on 2026-11-24, when its description gained sorting and the Apply
panel); no activation run has been recorded yet.

## palistor

Should load:

1. "Сделай форму регистрации с зависимыми полями: адрес доставки показывать только для курьера, и он тогда обязателен."
2. "The Save button does nothing on our settings form and no error shows up — find out why."
3. "Add a computed total (price × quantity) and a draft that survives a page reload to the order form."

Should not load (or not alone):

1. "Add pagination and a search box to the orders table." → `palistor-lists`
2. "Rewrite the README installation section." → no skill
3. "Our Chakra inputs want `isInvalid` renamed to `invalid` everywhere." → `palistor-field-mapping`

## palistor-lists

Should load:

1. "Add a customers table to the dashboard: fetch from /api/customers, show a spinner, an error with a retry button, and let me rename a customer inline."
2. "The 'Add row' button should show the new invoice line immediately and swap in the real id once the POST returns."
3. "Add search and 'only active' filtering plus Next/Previous pages to the orders list built with `defineList`."
4. "Clicking a column header in the products table should sort the rows; a second click reverses, a third goes back to the original order."
5. "Our customer filters hit the API on every keystroke. Let people pick a search and a role first and press Apply (or Enter), with a Cancel that restores what was applied."
6. "The orders table is paged by the API — sorting by amount has to happen on the server, not only on the visible page."

Should not load:

1. "Build a signup form with email, password and confirm-password validation." → `palistor`
2. "Make a three-step checkout where the shipping step is skipped for digital goods." → `palistor-flows`
3. "Our MUI TextField wants `error` and `helperText` instead of `isInvalid` and `errorMessage` — wire that up once." → `palistor-field-mapping`

## palistor-flows

Should load:

1. "Сделай регистрацию в три шага с кнопками Далее/Назад, шаг про компанию показывать только юрлицам."
2. "Our checkout wizard lets users click Next with empty required fields — fix it."
3. "Add a progress indicator showing completed and current steps of the onboarding."

Should not load:

1. "Add a phone field with validation to the profile form." → `palistor`
2. "Paginate the orders table and add a search filter." → `palistor-lists`
3. "Our MUI TextField shows a React warning about the isVisible prop." → `palistor-field-mapping`

## palistor-field-mapping

Should load:

1. "Подключи нашу форму к MUI: чтобы required/error/helperText приходили сами, без ручной проброски."
2. "React ругается: does not recognize the isVisible prop on a DOM element — после спреда поля в инпут."
3. "Write a reusable Select wrapper for our form fields."

Should not load:

1. "Make the address field required only for courier delivery." → `palistor`
2. "Build a 4-step onboarding wizard." → `palistor-flows`
3. "Load the users list from the API and show a retry button on failure." → `palistor-lists`

## palistor-ssr

Should load:

1. "Страница клиентов в нашем Next.js (App Router) должна приходить с сервера уже со строками и переводами, без повторного запроса списка в браузере."
2. "View source of the orders page shows `orders.title` instead of the heading and an empty table, although the data is there a moment later. Fix the server render."
3. "After moving the settings form to a Server Component page we get a hydration mismatch warning from the form. Find the cause."
4. "Our vitest suite runs in the node environment and the store's resolver is never called — the list stays empty in the test."
5. "Нужен глобальный стор на всё приложение в нашем Next.js (App Router): текущий пользователь приходит с сервера в layout, шапка и страницы читают одно состояние."

Should not load (or not alone):

1. "Add a customers table with a spinner, an error state and a retry button." → `palistor-lists`
2. "Translate the form labels with our `t()` function." (a client-only app) → `palistor`
3. "Save the wizard's step so a page reload restores it." → `palistor-flows`
4. "Our Vite SPA needs one settings store that the sidebar and the settings screen both read." (no server render) → `palistor`
