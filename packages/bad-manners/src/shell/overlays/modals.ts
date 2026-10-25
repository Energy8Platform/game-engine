import type { Container } from 'pixi.js';
import type { ModalOptions, ReplayModalOptions } from '@energy8platform/shell';
import type { BmCtx, Layer } from '../context';
import { body, display, num } from '../text';
import { C, TYPE } from '../theme';
import { buildCard } from './panel';

/** §5.7: a game-triggered message (no funds, network error …) — the small card with a white-outlined
 *  title bubble, body copy and pills. Never red: a coloured action is the primary pill, the rest
 *  secondary. */
export function buildModal(ctx: BmCtx, o: ModalOptions): Layer {
  return buildCard(ctx, {
    title: o.title,
    titleVariant: 'ink-outline-white',
    closable: o.availableClose,
    onClose: () => ctx.closeLayer(),
    content: (box, w) => {
      const t = body(o.body, TYPE.body, C.paper, { wrap: w, align: 'center' });
      t.x = (w - t.width) / 2;
      box.addChild(t);
      return t.height;
    },
    actions: (o.actions ?? []).map((a, _i, all) => ({
      label: a.title,
      kind: a.color || all.length === 1 ? 'primary' : 'secondary-white',
      onTap: () => {
        a.on?.();
        ctx.closeLayer();
      },
    })),
  });
}

/** The replay summary (not dismissable): mode, bet, cost, win multiplier, total win; START REPLAY
 *  closes it, runs the replay, then reopens it whatever the outcome. */
export function buildReplayModal(ctx: BmCtx, o: ReplayModalOptions, reopen: () => void): Layer {
  const bonus = Array.isArray(ctx.config.features.buyBonus) ? ctx.config.features.buyBonus.find((b) => b.id === o.bonusId) : undefined;
  const cost = bonus?.priceMultiplier ?? 1;
  const rows: Array<[string, string, boolean?]> = [
    ['Mode', bonus?.title ?? o.bonusId],
    ['Base bet', ctx.fmt(o.bet)],
    ['Cost multiplier', `${cost}×`],
    ['Total cost', ctx.fmt(o.bet * cost)],
    ['Win multiplier', `${o.payoutMultiplier}×`],
    ['Total win', ctx.fmtWin(o.payoutMultiplier * o.bet), true],
  ];
  return buildCard(ctx, {
    title: ctx.t('Replay'),
    closable: false,
    onClose: () => {},
    content: (box: Container, w: number) => {
      let y = 0;
      for (const [label, value, total] of rows) {
        const l = total ? display(ctx.t(label), 26, C.paper) : body(ctx.t(label), 20, C.grey400);
        const v = num(value, total ? 30 : 22, total ? C.lime : C.paper);
        const h = Math.max(l.height, v.height);
        l.position.set(0, y + (h - l.height) / 2);
        v.position.set(w - v.width, y + (h - v.height) / 2);
        box.addChild(l, v);
        y += h + 14;
      }
      return y - 14;
    },
    actions: [
      {
        label: ctx.t('Start replay'),
        onTap: () => {
          ctx.closeLayer();
          Promise.resolve(o.onReplay()).then(reopen, reopen);
        },
      },
    ],
  });
}
