import type { Context } from 'cordis';
import { extensionOf } from '../shell/ViewerDocument';
import type { ViewerProps } from './viewers';

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
]);
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['.mp4', '.webm', '.ogv']);

const byExtension = (set: ReadonlySet<string>) => (path: string) => set.has(extensionOf(path));

/**
 * The three native players. `urlFor` is what turns a project path into
 * something a `src` can fetch — encoding included.
 *
 * `Image`'s `match` ignores `entry.size` on purpose — `ViewerDocument`'s
 * `TOO_BIG_BYTES` guards reading a file's bytes onto the main thread for
 * the text/binary sniff; an `<img src>` never does that read at all, it
 * streams and decodes off the main thread in the browser's own image
 * pipeline, so a large image is the browser's business, not this
 * component's.
 */
function Image({ ctx, path }: ViewerProps) {
  return <img className="e8-viewer-image" src={ctx.files.urlFor(path)} alt={path} />;
}
function Audio({ ctx, path }: ViewerProps) {
  return (
    <audio
      className="e8-viewer-audio"
      controls
      src={ctx.files.urlFor(path)}
      data-testid="viewer-audio"
    />
  );
}
function Video({ ctx, path }: ViewerProps) {
  return (
    <video
      className="e8-viewer-video"
      controls
      src={ctx.files.urlFor(path)}
      data-testid="viewer-video"
    />
  );
}

export const name = 'viewers-media';
export const inject = ['viewers', 'files'];

export function apply(ctx: Context) {
  ctx.effect(() =>
    ctx.viewers.register({ id: 'image', match: byExtension(IMAGE_EXTENSIONS), component: Image }),
  );
  ctx.effect(() =>
    ctx.viewers.register({ id: 'audio', match: byExtension(AUDIO_EXTENSIONS), component: Audio }),
  );
  ctx.effect(() =>
    ctx.viewers.register({ id: 'video', match: byExtension(VIDEO_EXTENSIONS), component: Video }),
  );
}
