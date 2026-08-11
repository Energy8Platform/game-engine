/**
 * Виртуальный баланс демо-режима.
 *
 * Games API демо не поддерживает и отвечает OperationNotAllowed на раундовые
 * RPC демо-сессии, поэтому баланс ведёт клиент. Держать его здесь, а не на
 * бэкенде, — единственный способ не заводить кэш с TTL и не ломать stateless;
 * демо-деньги ничего не стоят.
 */

/** Копейки в валюте с двумя знаками: считаем в минорных единицах. */
const SCALE = 100;

export class DemoWallet {
  private minor: number;

  constructor(starting: number) {
    this.minor = Math.round(starting * SCALE);
  }

  get balance(): number {
    return this.minor / SCALE;
  }

  bet(amount: number): void {
    this.minor = Math.max(0, this.minor - Math.round(amount * SCALE));
  }

  credit(amount: number): void {
    this.minor += Math.round(amount * SCALE);
  }
}
