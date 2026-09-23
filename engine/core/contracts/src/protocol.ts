import type { Diagnostic } from './diagnostic';
import type { GameCompositionRow } from './project';
import type { SpinSchema } from './spin-schema';

/** One row of the composition: a plugin as the IDE shows it. */
export interface CompositionRow {
  /** Loader entry id, e.g. "a1b2c3:probe1". Stable across restarts. */
  id: string;
  /** Package name as written in the composition file. */
  name: string;
  disabled: boolean;
  /** cordis FiberState: 2 is ACTIVE, 3 is FAILED. */
  state: number | null;
  config: unknown;
  /**
   * A schemastery schema's raw `toJSON()` output — its own deduped
   * `{ uid, refs }` graph, not a flat `{ type, dict, meta }` object — or
   * null when the plugin declares no Config. A reader must rebuild it with
   * `new Schema(json)` (from the `schemastery` package) before reading
   * `.type`/`.dict`/`.meta`; reading those fields directly off this value
   * will find them undefined.
   */
  schema: unknown | null;
  /** Whether a config change restarts the plugin in place. */
  hot: boolean;
  /** Where the browser fetches this plugin's client half, or null when it has none. */
  clientUrl: string | null;
  /**
   * What that client half declared it needs — `e8.client.inject`, verbatim.
   * Empty when the row has no client half, and empty when it has one that
   * asks for nothing.
   *
   * Travels beside `clientUrl` because the browser applies a half through
   * `ctx.plugin()`, and cordis reads a plugin's needs off the object it is
   * handed, before the plugin runs. The editor never imports a package.json
   * — only the host can read one — so the host says here what the half
   * asked for, and `modules.ts` passes it straight to cordis. Without it
   * the field would be parsed, typed and read by nobody, which is exactly
   * why the RUNTIME half's own `inject` was deleted (see `E8RuntimeHalf`).
   */
  clientInject: string[];
}

export interface Snapshot {
  rows: CompositionRow[];
  diagnostics: Diagnostic[];
}

/**
 * Which speaker a `game-diagnostics` frame's list belongs to.
 *
 * Two of them reach the editor, and they are not the same voice:
 *
 *  - `game` — a running game's own `ctx.diagnostics`, forwarded by
 *    `ide-bridge` from the browser. Several connected game sockets are
 *    NOT one game seen several ways: a preview wall opens a tile per
 *    device preset, each its own page and its own socket, and each names
 *    itself in `GameDiagnosticsMessage.game`. So this field says WHICH
 *    SPEAKER, and `game` says which of the speaker's several selves —
 *    two axes, neither absorbing the other. This doc used to say the
 *    opposite (one game, most-recent-wins, the way `Snapshot` is shared),
 *    which was true of the model this protocol started in and is exactly
 *    the assumption the wall broke.
 *  - `host` — the host speaking for itself, for the one producer that is
 *    not in a browser at all: `dev-game.ts`'s `/api/spin` route, which
 *    runs in the host process and has no `ctx.diagnostics` to write into.
 *
 * **Set by the HOST, never declared by the sender**, and inferred from
 * where the frame entered rather than from anything in it: a frame that
 * arrived on an `/ide` socket is `game`, a frame the host originated is
 * `host`. A browser page has no identity this protocol could verify, and
 * "who said this" is a routing fact the host owns — the same reasoning
 * that keeps a reader from telling the two namespaces apart by inspecting
 * `Diagnostic.plugin`.
 */
export type GameDiagnosticsSource = 'game' | 'host';

/**
 * The order a newly connected client is told about the sources, and the
 * order a reader concatenates them to show the union — fixed rather than
 * insertion-ordered so the panel's row order is a property of the protocol
 * and not of which speaker happened to go first: the game's own account,
 * then what the host has to add about it.
 *
 * `readonly`, so "declared once, in one order" is something the compiler
 * holds rather than something its two consumers happen to observe. It
 * shipped as a mutable array, which left any importer a `push` or a
 * `reverse` away from reordering the panel for everyone — the same shape
 * of agreed-not-declared this whole slice is about, in the artifact the
 * slice made to end it.
 */
export const GAME_DIAGNOSTIC_SOURCES: readonly GameDiagnosticsSource[] = ['game', 'host'] as const;

/**
 * A running game's own diagnostics, riding the SAME `/ide` socket the
 * project's composition already does — client to server when `ide-bridge`
 * (the dev-only row that subscribes to a game's `ctx.diagnostics`) forwards
 * what it holds, server to client when the host passes that on to the
 * editor.
 *
 * **Each frame carries a whole list, and it replaces that SOURCE's list —
 * not the reader's whole picture.** Whole-list rather than a delta because
 * a delta only means something to a reader that already holds everything
 * before it, which makes "a client that just connected" a problem the
 * sender would have to solve. Per-source rather than global because two
 * speakers share this message type (see `GameDiagnosticsSource`) and
 * neither of them ever holds the other's list: a host frame carrying its
 * own `/api/spin` failure used to overwrite everything the game had
 * reported, terminally, since nothing makes the game speak again
 * afterwards. Measured, not theorised — see `engine/apps/web/tests/e2e/
 * diagnostics.spec.ts`. A reader keeps one list per source and shows the
 * union.
 *
 * **Its own type, deliberately not a reuse of `{type:'diagnostics'}`.**
 * That message carries the PROJECT's diagnostics, whose `plugin` is a
 * composition row id — a string a human wrote in `e8.yml`/`e8.patch.yml`.
 * A game's diagnostics carry a seam or mechanic id instead (see
 * `Diagnostic.plugin`'s own doc for the two disjoint namespaces). The two
 * namespaces could not meet on one socket before a live game could reach
 * the IDE at all; now that it can, the message TYPE is what tells a reader
 * which namespace `plugin` is drawn from. It has to be the type and not the
 * `plugin` string itself — a human is entitled to name a composition row
 * `session`, the same word a live game's own session seam uses to name
 * itself, and a reader guessing from that string would get it wrong on
 * exactly that project.
 */
export interface GameDiagnosticsMessage {
  type: 'game-diagnostics';
  diagnostics: Diagnostic[];
  /**
   * How many more this game's bounded log has forgotten — see
   * `@energy8engine/diagnostics`'s `DiagnosticsService.dropped()`. Travels
   * on every frame, not just once, because a panel that renders this list
   * has no other way to say the list is incomplete; a `dropped` a reader
   * has to remember from an earlier frame is a `dropped` that goes stale
   * the moment it's not repeated.
   */
  dropped: number;
  /**
   * Whose list this is — see `GameDiagnosticsSource`.
   *
   * Optional in the type, and that is not laziness about the server half:
   * the two directions genuinely differ. A client→server frame never
   * carries one (a game does not name itself; the host stamps it on the
   * way through), and a host older than this field sends none either. The
   * host always sets it on a server→client frame. **A reader that finds
   * it absent must read it as `game`** — the meaning this message had
   * before there was a second speaker — rather than inventing a third
   * bucket.
   */
  source?: GameDiagnosticsSource;
  /**
   * Which running game this list belongs to — see `IdeBridgeConfig.game`
   * (`@energy8engine/ide-bridge`) for where a bridge gets one: a URL
   * parameter, because the address a game was opened at is the one thing
   * that tells two tiles of a preview wall apart. Absent on a host frame —
   * the host is one speaker, not one of several games, so it has none of
   * its own to stamp.
   *
   * **Absent on a GAME frame is legal too, and means "the only game" — the
   * ordinary case, not a broken frame.** The same rule `source`'s own doc
   * states for itself. This field did not exist before a preview wall
   * could run several games against one host at once, and a project opened
   * the ordinary way still sends exactly one whole-list frame with nothing
   * else to be told apart from. It starts to matter only once that stops
   * being true — several tiles, each its own socket, each sending its OWN
   * whole list — and a reader keying retention only by `source` (`'game'`,
   * shared by every one of them) would let the second tile's list silently
   * replace the first's: the exact failure `source` itself exists to
   * prevent one level up, reached again one level down.
   *
   * **Stamped by the sender, unlike `source`.** The host can always tell a
   * game's socket from its own process — that is what `source` records —
   * but it has no way to tell two game sockets apart; only the bridge
   * itself knows which tile it is running in, so this travels client→host
   * exactly as the bridge set it, carried rather than invented by whatever
   * relays it onward.
   */
  game?: string;
}

/**
 * A named game is gone — its socket closed, and the host has released what
 * it retained for it. Host to browser only: the host is the one that can
 * see a socket close, and a game cannot announce its own disappearance.
 *
 * **The other half of `GameDiagnosticsMessage`'s retention.** That message
 * is how a reader learns a game exists and what it has to say; without
 * this one there was no way to learn it had stopped existing, so a client
 * that was connected while a wall tile was open kept that tile's rows for
 * the life of the page — rows attributed, by name, to a game that is no
 * longer running. The host had already decided this was worth fixing on
 * its own side (see `rpc.ts`'s `lastGameDiagnostics`, decision 3, which
 * calls an unbounded per-tile map "a leak, not a stale-but-true fact held
 * a while longer"); every reader downstream inherited the same problem and
 * had nothing to act on.
 *
 * **Only ever a NAMED game.** The anonymous game — a socket that sent no
 * `game` at all, the ordinary single-project case — is never announced
 * gone, exactly as the host never releases its retained frame: a game
 * going quiet BECAUSE it crashed is the case retention exists for, and
 * there is only ever one of those. It is the ids a wall can mint without
 * limit that have to be releasable.
 */
export interface GameGoneMessage {
  type: 'game-gone';
  /** Which game. Always present — see the type's own doc for why never absent. */
  game: string;
}

/** One project of the workspace. `id` is the directory name; a path never crosses the wire. */
export interface Project {
  id: string;
  /** `game/spec.json`'s `name` when it is a string; otherwise `id`. */
  name: string;
}

/** What a project id (its directory name, its `game_id`) may look like — spec §3. The host refuses anything else; the form does not offer it. */
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** One project template the host can copy. `id` is its directory name under the templates folder. */
export interface Template {
  id: string;
  /** `e8.template.yml`'s `name`. */
  name: string;
  /** `e8.template.yml`'s `description`, `''` when absent. */
  description: string;
}

export interface WorkspaceState {
  projects: Project[];
  /** What `create` accepts. `[]` when creating is impossible (the root is itself a project). */
  templates: Template[];
  /** The open project's id, or `null` when none is. */
  active: string | null;
  /** Where the active project's game is served, or `null` (no project, or its preview failed to bind). */
  previewUrl: string | null;
  /** Scan failures and the last `open()`'s refusals — replaced, never appended, on every change. */
  diagnostics: Diagnostic[];
}

/**
 * A GAME row's config was rewritten (`PUT /api/composition/rows/:id`) and
 * the patch re-read — sent to EVERY `/ide` socket, the editor's and the
 * game's alike. `rows` is the whole fresh composition, the same shape
 * `GET /api/composition` serves; `changed` names the row(s) edited.
 *
 * `reload` is the HOST's verdict, decided once from data (the row's `hot`
 * and which fields carry `applies: 'restart'`) so the two readers cannot
 * disagree: `false` — the game re-applies the changed rows in place
 * (`ide-bridge`), the session lives on; `true` — the IDE reloads the
 * preview, and the game does nothing on its own. Not retained for a
 * late-connecting client: the rows are one `GET` away.
 */
export interface GameCompositionMessage {
  type: 'game-composition';
  rows: GameCompositionRow[];
  reload: boolean;
  changed: string[];
}

/**
 * "Show this scene" — the IDE's Scenes screen asked the host
 * (`POST /api/scenes/preview { scene }`) and the host tells every `/ide`
 * socket. Only the running game's `ide-bridge` acts on it (it enters the
 * scene on the stage); the IDE's own sockets ignore the type. Not
 * retained: a game that connects later starts on its own first stage.
 */
export interface ScenePreviewMessage {
  type: 'scene-preview';
  scene: string;
}

/**
 * The running game's `transitions` registry, as ids — sent by its
 * `ide-bridge` once the stage row has applied, so the IDE can offer a
 * scene's `transition` as a pick rather than a free string. Replaces the
 * host's last list whole; the host mirrors it on `GET /api/composition`
 * (`GameCompositionResponse.transitions`).
 *
 * Travels BOTH ways, the same shape: up from the game's socket, and down
 * again from the host to every other `/ide` socket as it arrives — and to
 * a socket connecting later, in its greeting — so an IDE open before the
 * game booted still gets the list without a reload.
 */
export interface GameTransitionsMessage {
  type: 'game-transitions';
  ids: string[];
}

/** One node of a scene document — see spec §3. `children` mount into the node's view. */
export interface SceneNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: SceneNode[];
}

/** `scenes/<id>.scene.yml`, parsed. List order is draw order, first at the back. */
export interface SceneDoc {
  id: string;
  /** Every id here — nested or not — is unique across the WHOLE document, not just among its own parent's siblings. */
  nodes: SceneNode[];
  /**
   * The portrait variant (spec §6): per TOP-LEVEL node id, the props the
   * runtime lays over the node's own while the safe rect is taller than
   * wide — any prop, the type's own or a common one (`x`, `pin`,
   * `visible`, …). A nested node cannot be overridden; an id that is not a
   * root of `nodes` is a warning.
   */
  portrait?: { nodes: Record<string, Record<string, unknown>> };
}

/** Which files a node type takes, and which single prop the dropped/picked path lands in. */
export interface NodeTypeAccept {
  /** Extensions without the dot, lowercase (`'png'`, not `'.png'`). */
  extensions: string[];
  /** The prop `accept`ing the path. */
  prop: string;
  /** The sibling file's extension: `<stem>.<sibling>` must exist beside the path (a spine skeleton's `atlas`). */
  sibling?: string;
}

/** A node type the running game registered: its id and its props schema as schemastery JSON. */
export interface NodeTypeInfo {
  type: string;
  schema: unknown;
  /** The IDE's drop/pick target for this type, when it takes a file. */
  accept?: NodeTypeAccept;
  /** Every prop (may be more than `accept.prop`) that holds a project-relative asset path. */
  assetProps?: string[];
}

/** The whole document set, replaced whole — host to every `/ide` socket on any change. */
export interface ScenesMessage {
  type: 'scenes';
  scenes: SceneDoc[];
  diagnostics: Diagnostic[];
}

/** The game's node-type registry, both ways (up from the game, relayed down), like `game-transitions`. */
export interface NodeTypesMessage {
  type: 'node-types';
  types: NodeTypeInfo[];
}

/** "Highlight this node" — the IDE selected it; `node: null` clears. Not retained. */
export interface SceneSelectMessage {
  type: 'scene-select';
  scene: string;
  node: string | null;
}

/** What `GET /api/scenes` answers on the root and the preview alike. */
export interface ScenesResponse {
  scenes: SceneDoc[];
  diagnostics: Diagnostic[];
  nodeTypes: NodeTypeInfo[];
}

/**
 * What `GET /api/composition` answers (`runtime-assets.ts`, on the root
 * and the preview alike): the GAME's rows, the host's own diagnostics
 * about them, the `.spin` schema (`null` when there is none to read — the
 * field always rides, so a browser can tell "no schema" from an old host
 * that never heard of one), and `transitions` — the transition ids the
 * running game's `transitions` registry reported (`game-transitions`),
 * empty until a game connects.
 */
export interface GameCompositionResponse {
  rows: GameCompositionRow[];
  diagnostics: Diagnostic[];
  schema: SpinSchema | null;
  transitions: string[];
}

/** One node of a flow document. */
export interface FlowNode {
  id: string;
  kind: string;
  props?: Record<string, unknown>;
  ui?: { x: number; y: number };
}

/** One edge in a flow document, connecting two nodes. */
export interface FlowEdge {
  from: string;
  out?: string;
  to: string;
}

/** `flows/<id>.flow.yml`, parsed. */
export interface FlowDoc {
  version: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** A flow node kind the running game registered: its id, output labels, trigger status, and schema. */
export interface FlowKindInfo {
  kind: string;
  outs: string[];
  trigger: boolean;
  schema: unknown;
}

/** One entry in a flow trace, recording a node's execution. */
export interface FlowTraceEntry {
  run: number;
  node: string;
  out: string | null;
  at: number;
}

/** The flow document, sent by the host on any change. */
export interface FlowMessage {
  type: 'flow';
  doc: FlowDoc | null;
  diagnostics: Diagnostic[];
}

/** The flow node kind registry, both ways (up from the game, relayed down). */
export interface FlowKindsMessage {
  type: 'flow-kinds';
  kinds: FlowKindInfo[];
}

/** Flow trace entries, both ways (up from the game, relayed down). */
export interface FlowTraceMessage {
  type: 'flow-trace';
  entries: FlowTraceEntry[];
}

/** What `GET /api/flow` answers on the root and the preview alike. */
export interface FlowResponse {
  doc: FlowDoc | null;
  diagnostics: Diagnostic[];
  kinds: FlowKindInfo[];
}

/** One entry of a symbol's view tree — mirrors `SceneNode` but has no id/children: a symbol's own `NodeType` tree is fixed shape (`static`/`idle`/`win`), not user-nested. */
export interface SymbolNode {
  type: string;
  props: Record<string, unknown>;
}

/** Which of a symbol's views is showing: one of `BUILTIN_STATES`, or a key of its `states` map. */
export type SymbolState = string;

/** The three states every symbol may declare directly; every other name lives in `states`. */
export const BUILTIN_STATES = ['static', 'idle', 'win'] as const;

/** One symbol's definition: its id (what a reel's board carries) and a node per state it supports. `static` is required — a symbol always has a resting view; `idle`/`win` fall back to it when absent. */
export interface SymbolDef {
  id: string;
  name?: string;
  fit?: 'contain' | 'none';
  static: SymbolNode;
  idle?: SymbolNode;
  win?: SymbolNode;
  /** Named states a plan's `playState` step can play — a death morph, a celebration. Keys are identifiers; the three built-ins above are not allowed here. */
  states?: Record<string, SymbolNode>;
}

/** The node for a state, wherever it lives: `def.static`/`idle`/`win`, else `def.states[name]`. Never reads a prototype key. */
export function stateNode(def: SymbolDef, state: string): SymbolNode | undefined {
  if ((BUILTIN_STATES as readonly string[]).includes(state)) {
    return def[state as (typeof BUILTIN_STATES)[number]];
  }
  return def.states && Object.hasOwn(def.states, state) ? def.states[state] : undefined;
}

/** `symbols.yml`, parsed. */
export interface SymbolsDoc {
  version: 1;
  symbols: SymbolDef[];
}

/** The symbols document, sent by the host on any change — same shape as `FlowMessage`. */
export interface SymbolsMessage {
  type: 'symbols';
  doc: SymbolsDoc | null;
  diagnostics: Diagnostic[];
}

/** What `GET /api/symbols` answers on the root and the preview alike. `known` is the reel board's registered symbol ids/names — the IDE's pick target for `SymbolDef.id`. */
export interface SymbolsResponse {
  doc: SymbolsDoc | null;
  known: { id: string; name: string }[];
  diagnostics: Diagnostic[];
}

/** Host to browser. Slice 0 sends whole snapshots: they are small, and diffing is a later problem. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'diagnostics'; diagnostics: Diagnostic[] }
  | GameDiagnosticsMessage
  | GameGoneMessage
  | GameCompositionMessage
  | ScenePreviewMessage
  | GameTransitionsMessage
  | ScenesMessage
  | NodeTypesMessage
  | SceneSelectMessage
  | { type: 'workspace'; workspace: WorkspaceState }
  | FlowMessage
  | FlowKindsMessage
  | FlowTraceMessage
  | SymbolsMessage;

/** Browser to host. */
export type ClientMessage =
  | { type: 'update'; id: string; config: unknown }
  | GameDiagnosticsMessage
  | GameTransitionsMessage
  | NodeTypesMessage
  | FlowKindsMessage
  | FlowTraceMessage;
