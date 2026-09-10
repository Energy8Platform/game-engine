/**
 * A project's file tree, as a vocabulary. Nothing here reads a disk — that
 * is the host's job (`engine/ide/host/src/plugins/files.ts`); this is only
 * the shape the host and its consumers (the IDE's file tree, editor, and
 * whatever else Task 1 unblocks) agree on.
 *
 * The response bodies below are here for a reason worth remembering: they
 * used to be inline literals written twice, once by the route and once by
 * the browser plugin reading it, and the two drifted apart without anything
 * noticing — the client checked for `entries` before `diagnostics` and so
 * threw away the host's own explanation on the one route the containment
 * boundary actually fires on. A shape that crosses the wire is a contract
 * whether or not anyone writes it down; writing it down is what lets the
 * two ends fail to compile instead of failing in front of a user.
 */
import { type Diagnostic, type Severity, diagnostic } from './diagnostic';

export interface FileEntry {
  /** Path from the project root, using `/`, no leading slash. */
  path: string;
  kind: 'file' | 'dir';
  /** Bytes. Absent for directories. */
  size?: number;
}

/** `GET /api/files` — the whole tree, plus whatever the walk could not read. */
export interface FileTreeResponse {
  entries: FileEntry[];
  diagnostics: Diagnostic[];
}

/**
 * How any route refuses: never an empty status, always the diagnostics
 * that say why. Deliberately not files-specific — the host-wide boundary
 * in `engine/ide/host/src/index.ts` answers this same shape for every
 * route it wraps, which is why a client reading it must carry
 * `diagnostics` through before deciding the body was the wrong shape.
 */
export interface DiagnosticsResponse {
  diagnostics: Diagnostic[];
}

/**
 * `PUT /api/files/*` — the bytes, base64 in JSON. Not multipart: there is
 * no multipart parser in the host and no screen yet needs one.
 */
export interface FileWriteRequest {
  base64: string;
}

/**
 * Why a file operation refused, as a tag instead of prose. The host's
 * routes pick an HTTP status from this, and the reason it is a tag: they
 * used to pick it by regex-matching the English sentence the service had
 * written (`/was not found/i`), so translating a user-facing message —
 * which this IDE does — would have silently turned every 404 into a 400.
 */
export type FileFailure =
  | 'not-found'
  | 'outside-project'
  | 'protected-path'
  | 'is-symlink'
  | 'is-directory'
  | 'io-error'
  | 'malformed-request';

/** A files diagnostic, tagged with the machine-readable reason above. */
export function fileDiagnostic(
  severity: Severity,
  code: FileFailure,
  where: string,
  message: string,
  fix?: string,
): Diagnostic {
  return { ...diagnostic(severity, 'files', where, message, fix), code };
}
