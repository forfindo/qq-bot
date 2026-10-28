import type { Part } from '@/types/message-part';

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
}

export interface ExecResult {
  next?: boolean;
  content?: Part[];
}

export interface ScheduleTask {
  /** 定时任务调度的格式化字符串 **/
  cron: string;
  name: string;
  /** 返回true成功，false失败 **/
  task: (fireDate: Date) => boolean | Promise<boolean>;
}

export interface Command {
  name: string;
  pattern: string | RegExp;
  priority: number;
  execute: (
    input: string,
    ctx: { [key: string]: unknown },
    args?: string[]
  ) => Promise<ExecResult | undefined> | ExecResult | undefined;
}

export interface IPlugin {
  info: PluginInfo;
  load(): Command[];
  /** 插件可以定义init方法返回一些API，这些API会放到每个插件调用时的ctx **/
  init?: () => { [key: string]: unknown };
  /** 定时任务 **/
  getScheduleTask?: () => ScheduleTask[];
}

export interface ProcessResult {
  plugin: string;
  name: string;
  content?: Part[];
}

export interface RegistryResult {
  ok: boolean;
  failure?: {
    name: string;
    error: string;
  }[];
}

export interface LikeLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
