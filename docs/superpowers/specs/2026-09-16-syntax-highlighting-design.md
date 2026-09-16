# Подсветка синтаксиса — дизайн

Дата: 2026-09-16. Ветка `feat/slot-webide-cordis`, от `67ce1ca`.
Родительская спека: `2026-08-27-slot-webide-cordis-design.md` — §5 экран
«Код» (Monaco), §7 «всё — плагин, любую контрибуцию можно заменить».
Пользовательская история 1 из списка 2026-09-16: «как разработчик слотов я
хочу в редакторе кода видеть подсветку синтаксиса как для стандартных
файлов, так и для `.spin`». Пользователь выбрал «только подсветка, без
языковых сервисов».

## 1. Зачем (измерено)

- `monacoSlice.ts` собирает Monaco 0.56.0 без единой грамматики: API +
  фичи редактирования, один воркер. Причина записана там же — полный вход
  тянул 9,4 МБ воркеров четырёх языковых сервисов.
- `EditorDocument.tsx:235` выбирает язык `isSpin(path) ? 'spin' :
  'plaintext'`; язык `spin` нигде не зарегистрирован — Monaco молча
  рисует plaintext. `e8.yml`, `main.ts`, `spec.json`, `README.md` — тоже
  plaintext.
- Грамматики Monaco лежат в `monaco-editor/languages/definitions/<lang>/
  <lang>.js` (Monarch, `export const conf, language`). `typescript`,
  `yaml`, `html` импортируют `editor/editor.api.js` ради enum'ов
  `languages.IndentAction` — их нельзя импортировать статически из плагина
  (правило `Monaco.tsx`: Monaco грузится лениво, jsdom бросает при
  evaluate). `css`, `markdown` — чистые данные. `json` Monarch-грамматики
  не имеет: его токенайзер живёт в языковом сервисе
  (`features/json/tokenization.js`, `TokensProvider` поверх
  `jsonc-parser`).
- `.spin` по лексеру `spinml` (`casino_platform/e8/crates/spinml/src/
  lexer.rs`, `parser.rs`, `types.rs`): ключевые слова лексера `fn let if
  else while for in return break continue true false`; блоки верхнего
  уровня по идентификатору `record enum game action const`; контекстное
  `tag` (`enum X tag stage {`); типы `int float bool ctx outcome str`,
  массивы `[T]`, `[T; N]`; комментарии `--` до конца строки; строки
  `"…"` без переносов; литералы `int`/`float`; операторы `&& || !`,
  сравнения, арифметика; методы контекста `c.<ident>(…)`.
- Темы `e8-dark`/`e8-light` объявлены с `inherit: true` от `vs-dark`/`vs`
  и `rules: []` — цвета токенов придут из базовых тем без правок.
- Клиентские плагины ядра подключаются в `context.ts` через
  `ctx.plugin(module)`; контрибуции регистрируются сервисами по образцу
  `slots` (`register(meta) → retract`, повтор ключа — замена с warning).

## 2. Решения

| Вопрос | Решение | Почему |
|---|---|---|
| Где живёт список языков | Новый клиентский плагин `plugins/languages.ts`, сервис `ctx.languages` | Контрибуция, как `slots`: проектный плагин может добавить язык или подменить `spin` |
| Форма определения | `{ id: string; extensions: string[]; load: () => Promise<{ language: IMonarchLanguage; conf?: LanguageConfiguration }> }` | Единая ленивая форма: грамматики Monaco импортируют `editor.api.js`, значит грузятся только после Monaco; `spin` использует ту же форму (`load: async () => …`) — одна форма, не две |
| Сервис | `register(def): () => void` — повтор `id` заменяет молча — замена по `id` и есть путь расширения; warning только при коллизии расширений между разными `id`, возврат отзывает; `languageFor(path): string` — по последнему расширению (регистр не важен), `'plaintext'` если нет; `list(): LanguageDef[]`; `subscribe(fn): () => void` — уведомление на каждую мутацию | Тот же протокол, что у `slots`; `Monaco.tsx` слушает поздние регистрации |
| Кто применяет к Monaco | `Monaco.tsx` после `load()`: для каждого `def` — `monaco.languages.register({ id, extensions })`, `await def.load()`, `setMonarchTokensProvider(id, language)`, `setLanguageConfiguration(id, conf)` если есть; подписка на `subscribe` для поздних; повторная регистрация того же `id` — новый `setMonarchTokensProvider` (Monaco заменяет провайдер) | Плагин `languages` Monaco не импортирует — jsdom-правило сохраняется |
| Стандартные языки | Плагин `plugins/languages-basic.ts`: `typescript` (`.ts .tsx`), `javascript` (`.js .mjs .cjs .jsx`), `yaml` (`.yml .yaml`), `css` (`.css`), `html` (`.html`), `markdown` (`.md`) — `load: () => import('monaco-editor/languages/definitions/<lang>/<lang>.js')` (путь без `esm/vs/`, см. `monacoSlice.ts`) | Грамматики Monaco как есть; `javascript.js` сам реэкспортирует `typescript.js` |
| JSON | Своя Monarch-грамматика в `languages-basic` (`.json`, `.jsonc`): строки, ключ (строка перед `:`) отдельным токеном `type`, числа, `true false null`, `//` и `/* */` комментарии, скобки | У Monaco JSON без сервиса нет; `TokensProvider` из сервиса потребовал бы второй формы контракта ради ~20 строк |
| `.spin` | Плагин `plugins/language-spin.ts`: Monarch по §1 — `keyword` (лексер), `keyword` для `record enum game action const tag` только в позиции начала объявления (`tag` — после имени enum), `type` для `int float bool ctx outcome str`, `comment` `--`, `string`, `number`/`number.float`, `operator`, `delimiter`, `identifier`; `c.<ident>` — `function` (builtin контекста); `conf`: `comments.lineComment: '--'`, скобки `{} [] ()`, `autoClosingPairs` для скобок и `"`, `surroundingPairs` | Читаемый скрипт: блоки, типы, комментарии, строки различимы |
| Подключение | `context.ts`: `languages` перед `shell` (кто угодно после него регистрирует), `languages-basic` и `language-spin` — после `files`; `EditorDocument`: `language={ctx.languages.languageFor(path)}`; `isSpin` остаётся только для запуска `check` | Порядок: сервис раньше потребителей |
| Темы | Не трогаем: `inherit: true` от `vs-dark`/`vs` даёт цвета токенов; `rules: []` остаются | Ноль правок ради цвета |
| Сборка | Грамматики — динамические импорты, попадают в отдельные чанки; ноль новых воркеров. Дельта `vite build` (сумма `dist/assets`) — до/после в ноте среза | Обещание `monacoSlice.ts` («один воркер») остаётся правдой |
| Вне | TS/JSON/YAML языковые сервисы (completions, диагностика типов); автодополнение `.spin` по грамматике (остаётся word-based); folding; иконки файлов по языку в Explorer | Следующие срезы, если понадобятся |

## 3. Провод

```ts
// engine/ide/client/src/plugins/languages.ts
export interface LanguageDef {
  id: string;
  extensions: string[];               // с точкой: '.ts'
  load(): Promise<{ language: IMonarchLanguage; conf?: LanguageConfiguration }>;
}
export interface LanguagesService {
  register(def: LanguageDef): () => void;
  languageFor(path: string): string;  // 'plaintext' если не найден
  list(): readonly LanguageDef[];
  subscribe(fn: () => void): () => void;
}
declare module 'cordis' { interface Context { languages: LanguagesService } }
```

`IMonarchLanguage`/`LanguageConfiguration` — типы из
`monaco-editor/editor/editor.api.js` через `import type` (тип не тянет
модуль).

## 4. Отказ — это данные

- `def.load()` отверг промис или `setMonarchTokensProvider` бросил
  (грамматика не компилируется) → диагностика speaker `languages`
  (`error`, «language "<id>": <message>») в панель через `connection.report`
  (как `shell` докладывает о withdrawn contribution); язык остаётся
  зарегистрированным в Monaco без токенайзера — документ рисуется
  plaintext, редактор жив. Повторная регистрация того же `id` отзывает
  диагностику (retract).
- Два определения с одним расширением: последнее зарегистрированное
  выигрывает в `languageFor`, warning в консоль (как `slots`).
- Путь без расширения (`Makefile`, `.gitignore` — расширение `.gitignore`,
  не найдено) → `'plaintext'`, без диагностики.

## 5. Проверка

Юниты (`engine/ide/client/tests`):
- `languages`: `register` → `list`; тот же `id` — замена с warning;
  retract убирает; `languageFor('a/b.TS')` → `typescript`; без совпадения
  → `plaintext`; `subscribe` вызывается на register и retract.
- `Monaco.tsx` с фейком API: после `load()` для каждого def вызваны
  `languages.register`, `setMonarchTokensProvider`, при `conf` —
  `setLanguageConfiguration`; поздняя регистрация после монтирования
  доходит; отвергнутый `load()` → `report` с speaker `languages`, остальные
  языки применены.
- `language-spin`, JSON: грамматика проходит `compile` из
  `monaco-editor/editor/standalone/common/monarch/monarchCompile.js`
  (чистый модуль, без DOM — план проверяет спайком, что он грузится под
  vitest; если `monarchLexer` тоже грузится, токенизировать образцы строк:
  `fn pay_for(sym: int) -> float {` → `keyword identifier … type`,
  `-- comment` → `comment`, `let s = "x"` → `string`, `[int; 6]` → `type`,
  `c.rand(6)` → `function`).
- `EditorDocument`: язык документа берётся из `languageFor`; `check`
  по-прежнему запускается только для `.spin`.

Playwright (`syntax.spec.ts`, полная сюита): открыть `game/script.spin`,
`e8.yml`, `src/main.ts`, `game/spec.json` — в `.view-line` есть `span`
минимум с двумя разными классами `mtk*`; для `.spin` слово `fn` и слово
`pay_for` имеют разные классы; маркеры `check` на сломанном `.spin`
по-прежнему рисуются (регрессия среза 10).

Сборка: `npm run build -w @energy8engine/ide-web` — количество
`*.worker*` чанков не выросло; дельта размера записана в ноту.

## 6. Риски

| Риск | Что делаем |
|---|---|
| `monarchCompile.js` не грузится под vitest (тянет DOM) | Спайк первой задачей плана; откат — тест грамматики на форму (наличие правил для `--`, строк, ключевых слов) без компиляции |
| `typescript.js` Monaco тянет большой чанк | Ленивый импорт: чанк грузится при первом `.ts`; размер в ноте |
| Проектный плагин регистрирует язык до загрузки Monaco | Сервис хранит; `Monaco.tsx` применяет всё при `load()` и подписан на позднее — порядок не важен |
