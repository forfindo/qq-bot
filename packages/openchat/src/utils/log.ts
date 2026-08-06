import { Cause, Logger, References } from 'effect';

type Fields = Record<string, unknown>;

export interface ILog {
  trace: (format: string, params?: Record<string, unknown>) => void;
  debug: (format: string, params?: Record<string, unknown>) => void;
  info: (format: string, params?: Record<string, unknown>) => void;
  warn: (format: string, params?: Record<string, unknown>) => void;
  error: (format: string, params?: Record<string, unknown>) => void;
}

class DefaultLog implements ILog {
  private tag: string;

  constructor(s: string) {
    this.tag = s;
  }

  debug(format: string, params?: Record<string, unknown>): void {
    console.log(
      format.replace(/\{(.*?)}/g, (_, name: string) => params?.[name]?.toString() ?? 'unknown')
    );
  }

  error(format: string, params?: Record<string, unknown>): void {
    console.log(
      format.replace(/\{(.*?)}/g, (_, name: string) => params?.[name]?.toString() ?? 'unknown')
    );
  }

  info(format: string, params?: Record<string, unknown>): void {
    console.log(
      format.replace(/\{(.*?)}/g, (_, name: string) => params?.[name]?.toString() ?? 'unknown')
    );
  }

  trace(format: string, params?: Record<string, unknown>): void {
    console.log(
      format.replace(/\{(.*?)}/g, (_, name: string) => params?.[name]?.toString() ?? 'unknown')
    );
  }

  warn(format: string, params?: Record<string, unknown>): void {
    console.log(
      format.replace(/\{(.*?)}/g, (_, name: string) => params?.[name]?.toString() ?? 'unknown')
    );
  }
}

const normalizeKey = (key: string) => (key === 'sessionID' ? 'session.id' : key);

const clean = (input?: Fields): Fields => {
  return Object.fromEntries(
    Object.entries(input ?? {})
      .filter(entry => entry[1] !== void 0 && entry[1] !== null)
      .map(([key, value]) => [normalizeKey(key), value])
  );
};

const text = (input: unknown): string => {
  if (Array.isArray(input)) {
    return input.map(item => String(item)).join(' ');
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return input === void 0 ? '' : String(input);
};

export const logger = Logger.make(opts => {
  const extra = clean(opts.fiber.getRef(References.CurrentLogAnnotations));
  const now = opts.date.getTime();
  for (const [key, start] of opts.fiber.getRef(References.CurrentLogSpans)) {
    extra[`logSpan.${key}`] = `${now - start}ms`;
  }
  if (opts.cause.reasons.length > 0) {
    extra.cause = Cause.pretty(opts.cause);
  }

  const svc = typeof extra.service === 'string' ? extra.service : void 0;
  if (svc) {
    delete extra.service;
  }
  const log = svc ? create({ service: svc }) : Default;
  const msg = text(opts.message);

  switch (opts.logLevel) {
    case 'Trace':
    case 'Debug':
      return log.debug(msg, extra);
    case 'Warn':
      return log.warn(msg, extra);
    case 'Error':
    case 'Fatal':
      return log.error(msg, extra);
    default:
      return log.info(msg, extra);
  }
});

export const layer = Logger.layer([logger], { mergeWithExisting: false });

export function create(...args: unknown[]) {
  return new DefaultLog(args.toString());
}

export const Default = create({ service: 'default' });
