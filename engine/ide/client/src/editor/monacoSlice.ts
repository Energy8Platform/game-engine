/**
 * The slice of Monaco this IDE actually uses, assembled by hand.
 *
 * The package's top-level entry (`monaco-editor`) registers seventy
 * language grammars and four language SERVICES — TypeScript, CSS, HTML,
 * JSON — each of which brings its own web worker. Importing that entry
 * put 9.4 MB of worker chunks into `vite build` that nothing here ever
 * starts: the editor's `getWorker` hands back the generic editor worker
 * whatever the language, and the language edited here is `.spin`, which
 * none of the four has heard of. This module imports the bare API plus
 * the editor features a `.spin` author touches, so the build carries one
 * worker and no eager grammars.
 *
 * Grammars arrive another way since the highlighting slice: the
 * `languages` plugin holds definitions, `languages-basic` registers
 * Monaco's own Monarch tokenizers (lazily, one chunk each) and
 * `language-spin` ours, and `Monaco.tsx` hands them over after this
 * module has loaded. Still no language services, still one worker.
 *
 * Every specifier is spelled `monaco-editor/<path under esm/vs>`, never
 * `monaco-editor/esm/vs/<path>`: the package's exports map is
 * `"./*.js": "./esm/vs/*.js"`, so the `esm/vs/` segment is supplied by
 * the map and spelling it again resolves to `esm/vs/esm/vs/…`, which
 * does not exist and fails `vite build`. The apparently missing segment
 * is not missing.
 */
export * from 'monaco-editor/editor/editor.api.js';
// Typing, cursor movement, selection — the editor does nothing on a
// keypress without these.
import 'monaco-editor/editor/browser/coreCommands.js';
// A hover over a marker shows the diagnostic's message; F8 walks to the
// next one. Both are how a marker becomes readable, not just visible.
import 'monaco-editor/features/hover/register.js';
import 'monaco-editor/features/gotoError/register.js';
// The ordinary text-editing surface: find/replace, cut/copy/paste, the
// right-click menu, undo of cursor moves, multiple cursors, moving and
// duplicating lines, word-wise navigation, bracket pairs, comment
// toggling and indentation.
import 'monaco-editor/features/find/register.js';
import 'monaco-editor/features/clipboard/register.js';
import 'monaco-editor/features/contextmenu/register.js';
import 'monaco-editor/features/cursorUndo/register.js';
import 'monaco-editor/features/multicursor/register.js';
import 'monaco-editor/features/linesOperations/register.js';
import 'monaco-editor/features/wordOperations/register.js';
import 'monaco-editor/features/bracketMatching/register.js';
import 'monaco-editor/features/comment/register.js';
import 'monaco-editor/features/indentation/register.js';
// Word-based completion and same-word highlighting. With no language
// service for `.spin`, words already in the file are the only completions
// there are. The controller is imported by its own path because the
// package's `features/suggest` entry registers only the inline-completion
// half. These are also what actually starts the editor worker — the
// features above all run on the main thread — so this is where the
// `?worker` wiring in `Monaco.tsx` earns its place.
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/features/wordHighlighter/register.js';
