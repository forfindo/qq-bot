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
    ctx: PluginContext,
    args?: string[]
  ) => Promise<ExecResult | undefined> | ExecResult | undefined;
}

export type ListenerCallback = (ctx: PluginContext) => void | Promise<void>;

export interface IPlugin {
  info: PluginInfo;
  /** 插件可以定义init方法返回一些API，这些API会放到每个插件调用时的ctx **/
  init?: (ctx: PluginContext) => { [key: string]: unknown } | Promise<{ [key: string]: unknown }>;
  /** 命令 **/
  loadCommand(ctx: PluginContext): Command[] | Promise<Command[]>;
  /** 定时任务 **/
  loadSchedule?(ctx: PluginContext): ScheduleTask[] | Promise<ScheduleTask[]>;
  /** 事件监听 **/
  loadListener?(
    ctx: PluginContext
  ): Record<string, ListenerCallback> | Promise<Record<string, ListenerCallback>>;
}

export interface PluginContext {
  logger: LikeLogger;
  bot: unknown;
  state: Record<string, unknown>;
  [key: string]: unknown;
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
