/**
 * Reading the pool's per-round dump, whatever it was compressed with.
 *
 * The engine writes one `RoundDumpRecord` per line. That file is the biggest
 * thing the pipeline touches (tens of GB on a real game), so it exists in three
 * shapes and every reader has to cope with all of them:
 *
 *   books_<MODE>.jsonl       raw       — `-dump …/books_<MODE>.jsonl`
 *   books_<MODE>.jsonl.gz    gzip      — `-dump …/books_<MODE>.jsonl.gz`, written
 *                                        compressed by the engine in one pass
 *   books_<MODE>.jsonl.zst   zstd      — the legacy path: raw dump, then `zstd`
 *
 * `.gz` is inflated in-process (`zlib`), so no external binary is involved and
 * a multi-GB pool never lands on disk inflated. `.zst` still needs `zstd` on
 * PATH. Both `pool` (LUT building) and `curate` (events) read through here so
 * the preference order can never drift between them.
 */

import { existsSync, createReadStream, openSync, readSync, closeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export type LineStream = ReturnType<typeof createInterface>;

/**
 * True when the file starts with the gzip magic (RFC 1952: `1f 8b`).
 *
 * Content, not extension: an engine that predates gzipped dumps happily writes
 * plain JSONL to whatever path `-dump` names, `.gz` included. Sniffing the two
 * bytes is what lets the pipeline work with either engine without a version
 * probe, and it is also what stops a raw file from being handed to gunzip.
 */
export function isGzipFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(2);
    const read = readSync(fd, buf, 0, 2, 0);
    return read === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

/**
 * A line stream over one dump file. gzip is detected by magic bytes (so a
 * `.gz`-named raw file still reads), `.zst` by extension (it needs the external
 * `zstd` either way).
 *
 * Concatenated gzip members are read in full — the engine's workers each write
 * their own member and the parts are byte-copied together, which is a valid
 * gzip stream that `zlib` walks to the end.
 */
export function dumpLineStream(path: string): LineStream {
  if (isGzipFile(path)) {
    return createInterface({ input: createReadStream(path).pipe(createGunzip()) });
  }
  if (path.toLowerCase().endsWith('.zst')) {
    const proc = spawn('zstd', ['-dc', '-q', path], { stdio: ['ignore', 'pipe', 'inherit'] });
    return createInterface({ input: proc.stdout! });
  }
  return createInterface({ input: createReadStream(path, { encoding: 'utf-8' }) });
}

/** The pool's dump file for one mode: raw, then `.gz`, then `.zst`. Null when there is none. */
export function poolDumpPath(poolDir: string, mode: string): string | null {
  for (const ext of ['', '.gz', '.zst']) {
    const path = join(poolDir, `books_${mode}.jsonl${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
}

/** A line stream over the pool's dump for one mode, or null when the mode has no dump at all. */
export function poolDumpLineStream(poolDir: string, mode: string): LineStream | null {
  const path = poolDumpPath(poolDir, mode);
  return path ? dumpLineStream(path) : null;
}
