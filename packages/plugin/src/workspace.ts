import { mergeObject } from '@/utils/merge';
import { cancelJob, type Job, scheduleJob } from 'node-schedule';
import type {
  Command,
  IPlugin,
  LikeLogger,
  ListenerCallback,
  PluginContext,
  PluginInfo,
  ProcessResult,
  RegistryResult,
  ScheduleTask
} from '@/types/workspace';

function normalizePattern(pattern: string | RegExp): RegExp {
  if (typeof pattern === 'string') {
    return new RegExp(pattern.startsWith('^') ? pattern : '^' + pattern);
  }
  return pattern.source.startsWith('^') ? pattern : new RegExp('^' + pattern.source, pattern.flags);
}

export class Workspace {
  private plugins: (PluginInfo & { loadTime: number })[] = [];
  private commands: (Command & { plugin: string })[] = [];
  /** 根据插件名字 **/
  private apis: { [key: string]: { [key: string]: unknown } } = {};
  /** 定时任务列表 **/
  private tasks: (ScheduleTask & { plugin: string })[] = [];
  private runningTask: Job[] = [];
  private states: Record<string, Record<string, unknown>> = {};
  private listeners: Record<string, ListenerCallback[]> = {};
  private readonly logger: LikeLogger;
  private readonly bot: unknown;

  constructor(bot: unknown, logger: LikeLogger = console) {
    this.bot = bot;
    this.logger = logger;
  }

  private addSchedule(task: (typeof this.tasks)[number]) {
    const existing = this.tasks.find(
      item => item.plugin === task.plugin && item.name === task.name
    );
    if (existing) {
      return;
    }

    const job = scheduleJob(`${task.plugin}_${task.name}`, task.cron, async (fireDate: Date) => {
      try {
        const success = await task.task(fireDate);
        if (success) {
          this.logger.info(`定时任务 ${task.plugin}_${task.name} 执行成功`);
        } else {
          this.logger.error(`定时任务 ${task.plugin}_${task.name} 执行失败`);
        }
      } catch (e) {
        this.logger.error(
          `定时任务 ${task.plugin}_${task.name} 执行失败。${e instanceof Error ? e.message : String(e)}`
        );
      }
    });

    if (!job) {
      this.logger.error(`定时任务 ${task.name} cron 表达式非法: ${task.cron}`);
      return;
    }

    this.tasks.push(task);
    this.runningTask.push(job);
  }

  private cancelSchedule(task: (typeof this.tasks)[number]): void {
    const existingIndex = this.tasks.findIndex(
      item => item.plugin === task.plugin && item.name === task.name
    );
    const jobIndex = this.runningTask.findIndex(
      item => item.name === `${task.plugin}_${task.name}`
    );
    if (jobIndex >= 0) {
      cancelJob(this.runningTask[jobIndex]!);
      this.runningTask.splice(jobIndex, 1);
    }
    if (existingIndex >= 0) {
      this.tasks.splice(existingIndex, 1);
    }
  }

  private async load(plugin: IPlugin) {
    const name = plugin.info.name;
    try {
      // —— 准备阶段：只计算、不碰 this.*，任何抛错都安全 ——
      const state: Record<string, unknown> = {};
      const ctx: PluginContext = { logger: this.logger, bot: this.bot, state };

      const apis = await plugin.init?.(ctx);
      const commands = (await plugin.loadCommand(ctx)).map(item => ({
        plugin: name,
        ...item,
        pattern: normalizePattern(item.pattern)
      }));
      const tasks = ((await plugin.loadSchedule?.(ctx)) ?? []).map(item => ({
        ...item,
        plugin: name
      }));
      const listeners = await plugin.loadListener?.(ctx);

      // —— 提交阶段：下面全是无抛错的纯内存操作 ——
      this.deregister(name);
      this.states[name] = state;
      if (apis) {
        this.apis[name] = apis;
      }
      this.plugins.push({
        ...plugin.info,
        loadTime: Date.now()
      });
      this.commands.push(...commands);
      this.commands.sort((c1, c2) => c1.priority - c2.priority);
      for (const task of tasks) {
        this.addSchedule(task);
      }
      if (listeners) {
        for (const event of Object.keys(listeners)) {
          if (this.listeners[event]) {
            this.listeners[event].push(listeners[event]!);
          } else {
            this.listeners[event] = [listeners[event]!];
          }
        }
      }
    } catch (e) {
      return {
        name,
        error: String(e)
      };
    }
  }

  async registry(...plugins: IPlugin[]): Promise<RegistryResult> {
    const result: RegistryResult = {
      ok: true,
      failure: []
    };
    for (const plugin of plugins) {
      const errors = await this.load(plugin);
      if (errors) {
        result.ok = false;
        result.failure!.push(errors);
      }
    }
    return result;
  }

  async process(input: string, ctx: { [key: string]: unknown }) {
    const processResult: ProcessResult[] = [];
    const initApis = mergeObject(...Object.values(this.apis));
    for (const command of this.commands) {
      const result = input.match(command.pattern);
      if (result) {
        const prefix = result[0];
        const execRst = await command.execute(
          input.substring(prefix.length).trim(),
          {
            ...initApis,
            ...ctx,
            logger: this.logger,
            bot: this.bot,
            state: this.states[command.plugin] || {}
          },
          result.slice(1)
        );
        if (execRst?.content?.length) {
          processResult.push({
            plugin: command.plugin,
            name: command.name,
            content: execRst.content
          });
        }
        if (!execRst?.next) {
          break;
        }
      }
    }
    return processResult;
  }

  deregister(pluginName: string) {
    this.plugins = this.plugins.filter(item => item.name !== pluginName);
    this.commands = this.commands.filter(item => item.plugin !== pluginName);
    const removed = this.tasks.filter(item => item.plugin === pluginName);
    removed.forEach(item => this.cancelSchedule(item));
    Reflect.deleteProperty(this.apis, pluginName);
    Reflect.deleteProperty(this.states, pluginName);
  }

  listPlugin() {
    return this.plugins;
  }
}
