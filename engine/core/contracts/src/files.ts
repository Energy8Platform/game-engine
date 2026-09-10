/**
 * A project's file tree, as a vocabulary. Nothing here reads a disk — that
 * is the host's job (`engine/ide/host/src/plugins/files.ts`); this is only
 * the shape the host and its consumers (the IDE's file tree, editor, and
 * whatever else Task 1 unblocks) agree on.
 */
export interface FileEntry {
  /** Path from the project root, using `/`, no leading slash. */
  path: string;
  kind: 'file' | 'dir';
  /** Bytes. Absent for directories. */
  size?: number;
}
