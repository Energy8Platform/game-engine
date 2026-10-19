/**
 * Виртуальный баланс демо-режима.
 *
 * Games API демо не поддерживает и отвечает OperationNotAllowed на раундовые
 * RPC демо-сессии, поэтому баланс ведёт клиент. Держать его здесь, а не на
 * бэкенде, — единственный способ не заводить кэш с TTL и не ломать stateless;
 * демо-деньги ничего не стоят.
 *
 * Перезагрузку страницы он переживает: с `sessionId` кошелёк пишет себя в
 * `sessionStorage` под ключом этой сессии и читает оттуда на старте. Иначе
 * ревьюер, нажавший F5, видел бы баланс, вернувшийся к стартовому, — ровно
 * тот «refresh во время спина», который проверяют на реальных деньгах.
 * `sessionStorage` живёт, пока жива вкладка, а ключ по `sessionId` значит,
 * что новая демо-сессия начинается со своего стартового баланса. Хранилище
 * может быть недоступно (приватный режим, запрет cookies в iframe) — тогда
 * кошелёк просто не помнит себя, как раньше.
 */

/** Копейки в валюте с двумя знаками: считаем в минорных единицах. */
const SCALE = 100;

export function demoStorageKey(sessionId: string): string {
  return `artube:demo:${sessionId}`;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Сохранённый баланс или `null`. Значение правит кто угодно из devtools, но это демо-деньги:
 *  отбрасываем только то, что кошелёк не сможет показать. */
function readSaved(sessionId: string): number | null {
  try {
    const raw = storage()?.getItem(demoStorageKey(sessionId));
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export class DemoWallet {
  private minor: number;

  constructor(
    starting: number,
    private readonly sessionId?: string,
  ) {
    const saved = sessionId ? readSaved(sessionId) : null;
    this.minor = Math.round((saved ?? starting) * SCALE);
  }

  get balance(): number {
    return this.minor / SCALE;
  }

  bet(amount: number): void {
    this.minor = Math.max(0, this.minor - Math.round(amount * SCALE));
    this.save();
  }

  credit(amount: number): void {
    this.minor += Math.round(amount * SCALE);
    this.save();
  }

  private save(): void {
    if (!this.sessionId) return;
    try {
      storage()?.setItem(demoStorageKey(this.sessionId), String(this.balance));
    } catch {
      // Квота или запрет хранилища: игра идёт, забудется только баланс на перезагрузке.
    }
  }
}
