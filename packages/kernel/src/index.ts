/**
 * @energy8engine/kernel — the plugin kernel.
 *
 * Everything here is a pure function over plain data. The kernel knows nothing about renderers,
 * slots, spins or the DOM; it knows only how plugins declare extension points, how contributions
 * plug into them, and how a project's choices resolve into a plan.
 */

/** Kernel version. Plugin manifests declare the range they need via `engine`. */
export const KERNEL_VERSION = '0.1.0';
