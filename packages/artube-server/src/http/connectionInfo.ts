/**
 * `player_connection_info` — то, что платформа знает об игроке помимо сессии.
 *
 * Не косметика: по `ip_address` платформа определяет страну через GeoIP и
 * решает, разрешён ли игроку регион («Страна игрока определяется автоматически
 * на сервере через GeoIP сервис по IP-адресу», `session-info.md`; отказ —
 * `RegionNotSupported`). Мы слали пустой объект, то есть лицензионный контроль
 * принимал решение либо ни на чём, либо на адресе НАШЕГО пода — а под стоит в
 * датацентре платформы, и это всегда «правильная» страна.
 *
 * Единственное место, где эти данные есть, — HTTP-запрос на апгрейд
 * WebSocket'а. Дальше по стеку их нет ни у кого, поэтому они снимаются один раз
 * при приёме соединения и живут вместе с ним.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { PlayerConnectionInfo } from '../games-api/types.js';

/**
 * Диапазоны, которые не могут быть адресом игрока в интернете: петля, частные
 * сети RFC 1918, link-local, CGNAT, IPv6 unique-local. Ровно они и стоят в
 * `x-forwarded-for` от прокси и балансировщиков между игроком и подом.
 */
function isPublicIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return false;
    // fc00::/7 (unique local) и fe80::/10 (link-local).
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return false;
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return false;
    return true;
  }
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT, RFC 6598
  return true;
}

/** Синтаксически валидный IPv4/IPv6 — дока требует именно этого, иначе запрос не пройдёт валидацию. */
function isIpLiteral(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value.split('.').every((o) => Number(o) <= 255);
  }
  // Достаточно грубо: только hex-группы и двоеточия, хотя бы одно двоеточие.
  return value.includes(':') && /^[0-9a-f:]+$/i.test(value) && !value.includes(':::');
}

/**
 * Привести к голому адресу: `::ffff:1.2.3.4` (v4-mapped, как отдаёт Node на
 * dual-stack сокете), `[::1]:443` и `1.2.3.4:5678` (порт дописывают некоторые
 * прокси) — всё это адрес плюс шум.
 */
export function normaliseIp(raw: string): string | null {
  let value = raw.trim();
  if (value === '') return null;
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(value)) value = value.slice(7);
  // `1.2.3.4:5678` — но не IPv6, где двоеточий много.
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.indexOf(':'));
  return isIpLiteral(value) ? value : null;
}

/**
 * Адрес игрока из цепочки прокси.
 *
 * `x-forwarded-for` — это список `клиент, прокси1, прокси2`: каждый прокси
 * дописывает СПРАВА того, от кого получил запрос. Взять правый элемент —
 * гарантированно получить прокси, а не игрока; взять левый вслепую — принять
 * за адрес всё, что клиент сам написал в этот заголовок (проксям положено
 * дописывать к нему, а не затирать его).
 *
 * Допущение, которое здесь сделано, и почему: сколько хопов перед нами
 * доверенных, снаружи не наблюдаемо (это конфигурация платформенного ingress'а,
 * а не наш выбор), поэтому берётся ПЕРВЫЙ СЛЕВА элемент, который вообще похож
 * на публичный адрес. Внутренние адреса самой цепочки при этом пропускаются, а
 * подделать значение по-прежнему может клиент — но это ровно та же гарантия,
 * что и у любого GeoIP по XFF, и на порядок лучше отсутствия поля, при котором
 * регион определялся по нашему поду. Ничего похожего на адрес нет — поле не
 * отправляется вовсе: дока валидирует `ip_address` как IP, и мусор в нём
 * стоил бы отказа на весь SessionInfo.
 */
export function clientIp(
  forwardedFor: string | string[] | undefined,
  remoteAddress?: string,
): string | undefined {
  const chain = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? ''))
    .split(',')
    .map(normaliseIp)
    .filter((ip): ip is string => ip !== null);
  const forwarded = chain.find(isPublicIp) ?? chain[0];
  if (forwarded) return forwarded;
  // Прямое соединение (или прокси без заголовка): адрес сокета — это и есть
  // игрок. Приватный тут не отбрасываем: в дев-стенде он настоящий.
  return (remoteAddress && normaliseIp(remoteAddress)) || undefined;
}

/**
 * Снять всё, что известно об игроке, с запроса на апгрейд.
 *
 * `player_connection_id` генерируем сами: дока определяет его как
 * «идентификатор подключения игрока между клиентом и бэкендом игры», то есть
 * это ИМЕННО наш идентификатор, и никто другой его не выдаёт. Он же — половина
 * механизма `NewConnectionEvent`; вторая половина, подписчик, живёт в
 * `http/ws.ts` (`makeNewConnectionHandler`) и сравнивает объявленный
 * платформой id именно с этим значением.
 */
export function readConnectionInfo(req: IncomingMessage): PlayerConnectionInfo {
  const info: PlayerConnectionInfo = { player_connection_id: randomUUID() };
  const ip = clientIp(req.headers['x-forwarded-for'], req.socket?.remoteAddress);
  if (ip) info.ip_address = ip;
  const ua = req.headers['user-agent'];
  if (typeof ua === 'string' && ua !== '') info.user_agent = ua;
  return info;
}
