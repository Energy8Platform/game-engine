import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { openGameInfo } from '@/ui/pixi/components/GameInfo';
import { makeContext, defaultConfig } from './_host';

/**
 * A game-supplied custom `node` must SURVIVE the overlay teardown. The shell closes overlays with
 * destroy({ children: true }), which used to recursively destroy the game's node — so Game info
 * rendered blank on the SECOND open. The node is borrowed, not owned: it detaches on close and
 * re-mounts on reopen, mirroring the HTML shell (where the DOM node persists in config).
 */

function gameNode(): Container {
  const n = new Container();
  n.addChild(new Graphics().rect(0, 0, 120, 120).fill(0xff0000)); // "draw whatever we want"
  return n;
}

function hostWithNode(node: Container) {
  return makeContext({
    config: defaultConfig({
      gameInfo: { sections: [{ type: 'custom', title: 'Bosses', node }] },
    }),
  });
}

describe('custom node survives Game info open → close → reopen', () => {
  it('closing the overlay detaches the node instead of destroying it', () => {
    const node = gameNode();
    const ov = openGameInfo(hostWithNode(node)) as unknown as Container;
    ov.resize?.(1200, 675);
    expect(node.destroyed).toBe(false);

    // The shell tears the layer down with children — must NOT kill the game node.
    ov.destroy({ children: true });
    expect(node.destroyed).toBe(false);
    expect(node.parent).toBeNull(); // cleanly detached, ready to re-mount
  });

  it('the SAME node instance re-mounts (with its drawing) on reopen', () => {
    const node = gameNode();
    const host = hostWithNode(node);

    (openGameInfo(host) as unknown as Container).destroy({ children: true });
    const ov2 = openGameInfo(host) as unknown as Container;
    ov2.resize?.(1200, 675);

    expect(node.destroyed).toBe(false);
    expect(node.children.length).toBe(1); // its Graphics drawing is intact
    // re-parented somewhere inside the fresh overlay tree
    expect(node.parent).not.toBeNull();
  });
});
