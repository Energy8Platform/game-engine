# Slice 14 — syntax highlighting: what was left behind

Slice: `docs/superpowers/plans/2026-09-16-syntax-highlighting.md`, spec
`2026-09-16-syntax-highlighting-design.md`. Commits `4c6c510..5392a05` on
`feat/slot-webide-cordis` (eleven). Every file the IDE opens is
highlighted: TypeScript, JavaScript, YAML, CSS, HTML, Markdown through
Monaco's own Monarch grammars, loaded lazily one chunk each; JSON through a
twenty-line grammar of ours (Monaco keeps its JSON tokenizer inside the
language service, with a worker); `.spin` through a grammar written from
SpinML's lexer and parser. Languages are a contribution — `ctx.languages`
— so a project plugin can add one or replace `spin` by registering the same
id. The build still carries one worker; `dist/assets` went from 4000 KB to
4052 KB. User story 1 of the 2026-09-16 list is closed.

## Debts

1. **An indented declaration word is an identifier.** `record`, `enum`,
   `game`, `action`, `const` are keywords only at column 0 (Monarch's
   `matchOnlyAtLineStart`); SpinML's parser accepts them at any column.
   Every declaration in the reference script is at column 0. If it bites:
   `/^\s*(?:record|…)\b/`, the whitespace painted `keyword` is invisible.
2. **A language registered after a document is open does not recolour
   it.** The grammar reaches Monaco; the open model keeps its creation-time
   language until the document is reopened (`EditorDocument` reads
   `languageFor` at render, `Monaco.tsx` treats `language` as
   creation-time). Documented in `Monaco.tsx`.
3. **A `failed` diagnostic is retracted only by a re-registration**, not by
   the definition's own retract; extension-collision warnings are never
   retracted and re-emit on every re-registration (same as `slots`). The
   `offs` map in `languages.ts` keeps one inert closure per id for the
   plugin's life — bounded by the number of languages, not a leak.
4. **`def.load()` is called synchronously inside the registering plugin's
   `apply`** (through `subscribe`). A `load` that throws synchronously —
   a contract violation, it must return a promise — crashes that plugin
   instead of becoming a diagnostic. `Promise.resolve().then(load)` would
   make it data.
5. **The Monarch walker in `tests/monarch.ts` walks `root` only.** A
   grammar under test must keep single-line constructs in `root`; a rule
   with `next` is not followed. `'?'` is the walker's marker for "no rule",
   not Monaco's `defaultToken`.
6. **`syntax.spec.ts` presses `ArrowDown` 38 times** to reach line 39 of
   the fixture (`record Vars {`); commented, fails loudly if the header
   moves. Monaco's `Ctrl+End`/`Ctrl+Home` do nothing on this Mac —
   `Meta+ArrowDown/Up` is what moves the caret.
7. **Six identical `declare module` blocks in `src/monaco-modules.d.ts`**
   — Monaco ships no `.d.ts` beside its grammar modules; a wildcard
   ambient module would fold them into one. Kept explicit so an unlisted
   specifier fails loudly.
8. **No language services.** Completions in `.ts` stay word-based; JSON
   and YAML have no schema validation. The TypeScript service alone is
   9.4 MB of workers and needs the monorepo's types fed to it — its own
   slice, if ever.

## Method

- **Spike before the plan, not as its first task.** Whether
  `monarchCompile.js` and Monaco's grammar modules load under vitest was
  measured in two minutes before the plan was written; the plan then
  promised real tokenization tests instead of "tests on the grammar's
  shape", and every grammar bug this slice found (`..` as two delimiters,
  `?` unlexed) was found by tokenizing text, not by reading regexes.
- **A grammar module that imports `editor.api.js` is not data.** Three of
  Monaco's seven grammars do; the definition therefore carries a lazy
  `load()`, and every language — ours included — uses the one shape.
  Measured on the module source, not assumed from the file name.
- **The reference script is the arbiter.** "Every character of
  `first-slot`'s `.spin` reaches a rule" is the one test that speaks for
  the language rather than for the examples the plan's author could think
  of; it still missed `..` — a token can reach the WRONG rule — so the
  review read the script too.
- **A brief-written test that cannot fail is found by disabling the fix.**
  The re-registration-order test as first written passed with and without
  the fix; the implementer said so, the second version was checked RED
  with the fix commented out.
- **Assertions on a rendered editor are line-scoped.** `classOf(word)`
  over the whole viewport is honest only until the word appears earlier;
  `classOf(line, word)` is honest by construction. Monaco renders spaces
  as U+00A0 and merges same-colour neighbours — both measured by running
  the draft, both now in the spec's module doc.
- **A running host is the user's.** Playwright needed 5679; a manual `e8`
  held it. The task waited, polled, and reported rather than killing a
  process it had not started.
