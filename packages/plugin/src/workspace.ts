import { mergeObject } from '@/utils/merge';
import { cancelJob, type Job, scheduleJob } from 'node-schedule';
import type {
  Command,
  IPlugin,
  LikeLogger,
  ProcessResult,
  RegistryResult,
  ScheduleTask
} from '@/types/workspace';

export class Workspace {
  private plugins: (Omit<IPlugin, 'load'> & { loadTime: number })[] = [];
  private commands: (Command & { plugin: string })[] = [];
  /** 根据插件名字 **/
  private apis: { [key: string]: { [key: string]: unknown } } = {};
  /** 定时任务列表 **/
  private tasks: (ScheduleTask & { plugin: string })[] = [];
  private runningTask: Job[] = [];
  private logger: LikeLogger;

  constructor(logger: LikeLogger = console) {
    this.logger = logger;
  }

  private addSchedule(task: (typeof this.tasks)[number]) {
    const existing = this.tasks.find(
      item => item.plugin === task.plugin && item.name === task.name
    );
    if (existing) {
      return;
    }
    this.tasks.push(task);
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
    if (job) {
      this.runningTask.push(job);
    } else {
      this.logger.error(`定时任务 ${task.name} cron 表达式非法: ${task.cron}`);
    }
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

  registry(...plugins: IPlugin[]): RegistryResult {
    const result: RegistryResult = {
      ok: true,
      failure: []
    };
    plugins.forEach(plugin => {
      try {
        const apis = plugin?.init?.();
        const commands = plugin.load();
        this.deregister(plugin.info.name);
        if (apis) {
          this.apis[plugin.info.name] = apis;
        }
        this.plugins.push({
          info: plugin.info,
          loadTime: Date.now()
        });
        this.commands.push(
          ...commands.map(item => {
            const result = {
              plugin: plugin.info.name,
              ...item
            };
            if (typeof result.pattern === 'string') {
              if (!result.pattern.startsWith('^')) {
                result.pattern = '^' + result.pattern;
              }
              result.pattern = new RegExp(result.pattern);
            } else if (!result.pattern.source.startsWith('^')) {
              result.pattern = new RegExp('^' + result.pattern.source, result.pattern.flags);
            }
            return result;
          })
        );
        this.commands.sort((c1, c2) => c1.priority - c2.priority);
        const pluginTask = plugin?.getScheduleTask?.()?.map(item => ({
          ...item,
          plugin: plugin.info.name
        }));
        pluginTask?.forEach(task => {
          this.addSchedule(task);
        });
      } catch (e) {
        result.ok = false;
        result.failure!.push({
          name: plugin.info.name,
          error: String(e)
        });
      }
    });
    return result;
  }

  async process(input: string, ctx: { [key: string]: unknown }) {
    const processResult: ProcessResult[] = [];
    const initApis = mergeObject(...Object.values(this.apis));
    for (const command of this.commands) {
      if (typeof command.pattern === 'string') {
        command.pattern = new RegExp(command.pattern);
      }
      const result = input.match(command.pattern);
      if (result) {
        const prefix = result[0];
        const execRst = await command.execute(
          input.substring(prefix.length).trim(),
          {
            ...initApis,
            ...ctx
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
    this.plugins = this.plugins.filter(item => item.info.name !== pluginName);
    this.commands = this.commands.filter(item => item.plugin !== pluginName);
    const removed = this.tasks.filter(item => item.plugin === pluginName);
    removed.forEach(item => this.cancelSchedule(item));
    Reflect.deleteProperty(this.apis, pluginName);
  }

  listPlugin() {
    return this.plugins;
  }
}
