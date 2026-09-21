/**
 * How a scene node's numeric props are rounded before they are written —
 * the multiplier each is rounded to a unit of: positions AND sizes whole
 * (both are design px), `scale` to 0.01, `rotation` to 0.0001 radians.
 * What the canvas measures is a float (`279.99998474121094`); the file
 * reads `280`.
 *
 * ONE table, read by both writers of the same file: `scene-edit`'s
 * `applyEdit` (the canvas' optimistic patch and the `edit` it tells) and
 * the IDE's `roundProps` (the value it writes). Two tables meant the
 * IDE's echo of an edit never matched the canvas' pending copy, so it was
 * never acknowledged and the node snapped by the difference.
 */
export const sceneRounding: Record<string, number> = {
  x: 1,
  y: 1,
  width: 1,
  height: 1,
  scale: 100,
  rotation: 10_000,
};
