/**
 * The gated `transformEvents` pass over engine-written books.
 *
 * A transform like paper-duel's exists for one reason: Stake rejects a book
 * whose `events` field exceeds 1 MiB, so oversized books get their `spin`
 * payloads deflated. It fires on a handful of books out of hundreds of
 * thousands — but the pipeline used to pay for it on every single one, because
 * applying a JS function to a book means parsing and re-serializing it.
 *
 * With `transformEventsWhenBytesOver` the config states that threshold, so this
 * pass can decide from the raw bytes: a line shorter than the gate is copied
 * through untouched (no parse, no stringify), and only the rare long one is
 * parsed, transformed, re-derived and rewritten. The gate is a promise about
 * the transform — below it, the transform is a no-op — and it is the game's own
 * threshold, so it is a promise the game already keeps.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { STAKE_EVENTS_MAX_BYTES } from '../types.js';
import { isGzipFile } from './dump-io.js';
import type { ResolvedMode } from '../mathConfig';

export interface RewriteResult {
  /** Lines read. */
  books: number;
  /** Lines the transform actually rewrote. */
  rewritten: number;
  /** Largest `events` field after the transform, in bytes. */
  maxEventsBytes: number;
  /** Book id holding it. */
  maxEventsBytesBookId: number;
  /** Books still over Stake's limit after the transform. */
  booksOverEventsLimit: number;
}

/** The `id` of a book line, read off the front without parsing it. */
function bookIdOf(line: string): number {
  const end = line.indexOf(',', 6);
  return end > 0 ? Number(line.slice(6, end)) : -1;
}

interface BookLine {
  id: number;
  payoutMultiplier: number;
  events: Record<string, unknown>[];
  criteria: string;
}

/** `criteria` as curate derives it — recomputed here because a transform may change the events. */
function deriveCriteria(payoutCents: number, events: Record<string, unknown>[], capCents: number): string {
  if (payoutCents <= 0) return '0';
  if (capCents > 0 && payoutCents >= capCents) return 'wincap';
  return events.some((e) => e.type === 'free_spin') ? 'freegame' : 'basegame';
}

/**
 * Stream `inPath` (raw or gzip) to `outPath`, transforming only the lines whose
 * serialized `events` reach `gate` bytes.
 *
 * The gate is compared against the whole line, which is a few dozen bytes longer
 * than the `events` field it wraps — deliberately generous, since being wrong in
 * that direction only means parsing a line the transform then leaves alone.
 */
export async function rewriteOversizedBooks(opts: {
  inPath: string;
  outPath: string;
  mode: ResolvedMode;
  gate: number;
}): Promise<RewriteResult> {
  const { inPath, outPath, mode, gate } = opts;
  const transform = mode.transformEvents!;
  const capCents = mode.curate.capMaxWin;

  const input = isGzipFile(inPath)
    ? createReadStream(inPath).pipe(createGunzip())
    : createReadStream(inPath, { encoding: 'utf-8' });
  const out = createWriteStream(outPath);
  const rl = createInterface({ input });

  const res: RewriteResult = {
    books: 0, rewritten: 0, maxEventsBytes: 0, maxEventsBytesBookId: -1, booksOverEventsLimit: 0,
  };

  const write = (line: string): Promise<void> | void => {
    if (!out.write(line)) return once(out, 'drain').then(() => undefined);
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    res.books++;

    if (line.length < gate) {
      // Under the gate the transform is a no-op by contract, so the bytes the
      // engine produced are already the bytes that ship. The size stat uses the
      // whole line as a stand-in for its `events` field: an over-estimate by the
      // ~60-byte wrapper, which is the harmless direction for a 1 MiB guard and
      // costs nothing next to parsing the line to measure it exactly.
      if (line.length > res.maxEventsBytes) {
        res.maxEventsBytes = line.length;
        res.maxEventsBytesBookId = bookIdOf(line);
      }
      await write(line + '\n');
      continue;
    }

    const book = JSON.parse(line) as BookLine;
    const events = transform(book.events, {
      mode: mode.mode, bookId: book.id, payoutCents: book.payoutMultiplier, capCents,
    });
    if (!Array.isArray(events)) {
      throw new Error(
        `transformEvents must return an array (book id ${book.id}, mode ${mode.mode}), got ${typeof events}`,
      );
    }
    res.rewritten++;
    const eventsJson = JSON.stringify(events);
    const bytes = Buffer.byteLength(eventsJson, 'utf8');
    if (bytes > res.maxEventsBytes) {
      res.maxEventsBytes = bytes;
      res.maxEventsBytesBookId = book.id;
    }
    if (bytes > STAKE_EVENTS_MAX_BYTES) res.booksOverEventsLimit++;
    const criteria = deriveCriteria(book.payoutMultiplier, events, capCents);
    await write(
      `{"id":${book.id},"payoutMultiplier":${book.payoutMultiplier},"events":${eventsJson},` +
        `"criteria":${JSON.stringify(criteria)}}\n`,
    );
  }

  out.end();
  await once(out, 'finish');
  return res;
}
