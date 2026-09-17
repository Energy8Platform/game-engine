/**
 * Scenes against the script (spec: scenes and layers, host half). The
 * `stage1` row's `scenes` are keyed by spin stage, so the two files that
 * name stages — `e8.patch.yml` and `game/script.spin` — can drift apart,
 * and nothing in either would notice: a scene with no stage is never
 * entered, a stage with no scene shows every layer. `checkScenes` says so,
 * reported through `ideRpc.reportGameDiagnostics('scenes', …)` — the
 * host's own list, replaced whole each time, so a fixed row is taken back
 * by the next check rather than left standing.
 *
 * Re-checked on the two things that move either side: a row write
 * (`game-composition/written`, after `runtime-assets.ts`'s PUT has
 * re-read `project` and `spinSchema`) and a `.spin` write or removal
 * through `files.ts` (`files/written`/`files/removed` — `spinSchema` is
 * re-read here first; nothing else re-reads it on a save). Neither
 * service emits on its own.
 *
 * `POST /api/scenes/preview { scene }` is the Scenes screen's "show me":
 * the frame goes to every `/ide` socket (`broadcastScenePreview`), and the
 * answer carries a warning when no preview is up to receive it — the
 * frame still goes, harmlessly, to whoever is listening.
 */
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type DiagnosticsResponse } from '@energy8engine/contracts';

/** Every scene is a stage, every stage a scene, every scene's layers declared, layer ids unique. Silent for a config with neither `layers` nor `scenes` (an older stage row). */
export function checkScenes(stageConfig: unknown, stageNames: string[]): Diagnostic[] {
  const cfg = (stageConfig ?? {}) as { layers?: unknown; scenes?: unknown };
  if (!Array.isArray(cfg.layers) && !cfg.scenes) return [];
  const out: Diagnostic[] = [];
  // A hand-typed `layers: bg` or `scenes: x` is not this check's subject
  // (the row's own schema refuses it on a PUT): read as empty, never thrown on.
  const ids = Array.isArray(cfg.layers)
    ? cfg.layers.map((l) => String((l as { id?: unknown } | null)?.id ?? ''))
    : [];
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
    out.push(
      diagnostic(
        'error',
        'scenes',
        id,
        `layer "${id}" is declared twice`,
        'give each layer one id',
      ),
    );
  }
  const known = new Set(ids);
  const scenes = (
    typeof cfg.scenes === 'object' && cfg.scenes !== null && !Array.isArray(cfg.scenes)
      ? cfg.scenes
      : {}
  ) as Record<string, { layers?: unknown } | null>;
  for (const [scene, spec] of Object.entries(scenes)) {
    const layers = Array.isArray(spec?.layers) ? spec.layers : [];
    const missing = layers.map(String).filter((l) => !known.has(l));
    if (missing.length) {
      out.push(
        diagnostic(
          'error',
          'scenes',
          scene,
          `scene "${scene}" names ${missing.map((m) => `"${m}"`).join(', ')}, which stage1.config.layers does not declare`,
          'declare the layer, or drop it from the scene',
        ),
      );
    }
    if (!stageNames.includes(scene)) {
      out.push(
        diagnostic(
          'warning',
          'scenes',
          scene,
          `scene "${scene}" has no stage of that name in the script`,
          'name scenes after `enum … tag stage` members',
        ),
      );
    }
  }
  for (const stage of stageNames) {
    if (!(stage in scenes)) {
      out.push(
        diagnostic(
          'warning',
          'scenes',
          stage,
          `stage "${stage}" has no scene — every layer will be shown in it`,
          'add a scene of that name',
        ),
      );
    }
  }
  return out;
}

export const name = 'scenes';
export const inject = ['server', 'ideRpc', 'project', 'spinSchema'];

export function apply(ctx: Context): void {
  // Reported only once there is, or was, something to say: an empty
  // report from a speaker that never spoke would tell a client "nothing
  // to report" where it had "no game connected yet" (see `rpc.ts`).
  let spoken = false;
  const recheck = () => {
    const rows = ctx.project.composition.rows;
    const row =
      rows.find((r) => r.name === '@energy8engine/stage') ?? rows.find((r) => r.id === 'stage1');
    const stages = Object.keys(ctx.spinSchema.schema?.stages ?? {});
    const found = row ? checkScenes(row.config, stages) : [];
    if (found.length || spoken) ctx.ideRpc.reportGameDiagnostics('scenes', found);
    spoken = found.length > 0;
  };
  recheck();
  ctx.on('game-composition/written', recheck);
  const onSpin = ({ path }: { path: string }) => {
    // `reload` never throws; the catch covers `recheck` racing a dispose.
    if (path.endsWith('.spin'))
      void ctx.spinSchema
        .reload()
        .then(recheck)
        .catch(() => {});
  };
  ctx.on('files/written', onSpin);
  ctx.on('files/removed', onSpin);

  ctx.server.post('/api/scenes/preview', async (req, res) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
    const scene = (body as { scene?: unknown } | null | undefined)?.scene;
    if (typeof scene !== 'string' || scene === '') {
      res.status = 400;
      const refusal: DiagnosticsResponse = {
        diagnostics: [
          diagnostic(
            'error',
            'scenes',
            req.path,
            `POST ${req.path} needs a JSON body shaped {"scene": string}`,
          ),
        ],
      };
      res.json(refusal);
      return;
    }
    ctx.ideRpc.broadcastScenePreview({ scene });
    const response: DiagnosticsResponse = {
      diagnostics: ctx.get('devGamePreview')?.url
        ? []
        : [
            diagnostic(
              'warning',
              'scenes',
              scene,
              'no preview is running, so nothing is showing the scene',
              'open a project with a game/ directory, or free the preview port',
            ),
          ],
    };
    res.json(response);
  });
}
