export interface ILog {
  trace: (format: string, params: Record<string, unknown>) => void;
  debug: (format: string, params: Record<string, unknown>) => void;
  info: (format: string, params: Record<string, unknown>) => void;
  warn: (format: string, params: Record<string, unknown>) => void;
  error: (format: string, params: Record<string, unknown>) => void;
}

export function create() {
  return new DefaultLog();
}

class DefaultLog implements ILog {
  debug(format: string, params: Record<string, unknown>): void {
    console.log(format.replace(/\{(.*?)}/g, (_, name) => params[name as string]?.toString() ?? 'unknown'));
  }

  error(format: string, params: Record<string, unknown>): void {
    console.log(format.replace(/\{(.*?)}/g, (_, name) => params[name as string]?.toString() ?? 'unknown'));
  }

  info(format: string, params: Record<string, unknown>): void {
    console.log(format.replace(/\{(.*?)}/g, (_, name) => params[name as string]?.toString() ?? 'unknown'));
  }

  trace(format: string, params: Record<string, unknown>): void {
    console.log(format.replace(/\{(.*?)}/g, (_, name) => params[name as string]?.toString() ?? 'unknown'));
  }

  warn(format: string, params: Record<string, unknown>): void {
    console.log(format.replace(/\{(.*?)}/g, (_, name) => params[name as string]?.toString() ?? 'unknown'));
  }
}
