import path from 'path';
import { AppFileSystem } from '@/file';
import { which } from '@/utils/which';
import { lazy } from '@/utils/lazy';
import { Flag } from '@/flag';

const META: Record<string, { deny?: boolean; login?: boolean; posix?: boolean; ps?: boolean }> = {
  bash: { login: true, posix: true },
  dash: { login: true, posix: true },
  fish: { deny: true, login: true },
  ksh: { login: true, posix: true },
  nu: { deny: true },
  powershell: { ps: true },
  pwsh: { ps: true },
  sh: { login: true, posix: true },
  zsh: { login: true, posix: true }
};
const defaultAcceptable = lazy(() => select(process.env.SHELL, { acceptable: true }));

export const name = (file: string) => {
  if (process.platform === 'win32') {
    return path.win32.parse(AppFileSystem.windowsPath(file)).name.toLowerCase();
  }
  return path.basename(file).toLowerCase();
};

const meta = (file: string) => {
  return META[name(file)];
};

export const posix = (file: string) => {
  return meta(file)?.posix === true;
};

export const ps = (file: string) => {
  return meta(file)?.ps === true;
};

const ok = (file: string) => {
  return meta(file)?.deny !== true;
};

const rooted = (file: string) => {
  return path.isAbsolute(AppFileSystem.windowsPath(file));
};

const win = () => {
  return Array.from(
    new Set(
      [which('pwsh'), which('powershell'), gitbash(), process.env.COMSPEC || 'cmd.exe']
        .filter((item): item is string => Boolean(item))
        .map(full)
    )
  );
};

export const gitbash = () => {
  if (process.platform !== 'win32') {
    return;
  }
  if (Flag.GIT_BASH_PATH) {
    return Flag.GIT_BASH_PATH;
  }
  const git = which('git');
  if (!git) {
    return;
  }
  const file = path.join(git, '..', '..', 'bin', 'bash.exe');
  if (AppFileSystem.stat(file)?.size) {
    return file;
  }
};

const full = (file: string) => {
  if (process.platform !== 'win32') {
    return file;
  }
  const shell = AppFileSystem.windowsPath(file);
  if (path.win32.dirname(shell) !== '.') {
    if (shell.startsWith('/') && name(shell) === 'bash') {
      return gitbash() || shell;
    }
    return shell;
  }
  if (name(shell) === 'bash') {
    return gitbash() || which(shell) || shell;
  }
  return which(shell) || shell;
};

const resolve = (file: string) => {
  const shell = full(file);
  if (rooted(shell)) {
    if (AppFileSystem.stat(shell)?.type === 'File') {
      return shell;
    }
    return;
  }
  return which(shell) ?? void 0;
};

const fallback = () => {
  if (process.platform === 'darwin') {
    return '/bin/zsh';
  }
  const bash = which('bash');
  if (bash) {
    return bash;
  }
  return '/bin/sh';
};

const select = (file: string | undefined, opts?: { acceptable?: boolean }) => {
  if (file && (!opts?.acceptable || ok(file))) {
    const shell = resolve(file);
    if (shell) {
      return shell;
    }
  }
  if (process.platform === 'win32') {
    return win()[0]!;
  }
  return fallback();
};

export const acceptable = (configShell?: string) => {
  if (configShell) {
    return select(configShell, { acceptable: true });
  }
  return defaultAcceptable();
};
acceptable.reset = () => defaultAcceptable.reset();
