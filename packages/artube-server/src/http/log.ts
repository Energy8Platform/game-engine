/**
 * Структурированный логгер. Формат задан платформой: JSON, одна строка на
 * запись, поля timestamp / level / message / service / trace_id / error / context.
 */

export type Level = 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  child(context: LogContext): Logger;
}

export function createLogger(service: string, base: LogContext = {}): Logger {
  const write = (level: Level, message: string, context?: LogContext, error?: unknown) => {
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service,
    };
    const merged = { ...base, ...context };
    if (merged.trace_id) record.trace_id = merged.trace_id;
    if (error instanceof Error) {
      record.error = { type: error.name, stack: error.stack };
    } else if (error !== undefined) {
      record.error = { type: 'unknown', stack: String(error) };
    }
    if (Object.keys(merged).length > 0) record.context = merged;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(record));
  };
  return {
    info: (m, c) => write('info', m, c),
    warn: (m, c) => write('warn', m, c),
    error: (m, e, c) => write('error', m, c, e),
    child: (context) => createLogger(service, { ...base, ...context }),
  };
}
