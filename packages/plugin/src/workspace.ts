import type { Part } from '@/message-part';

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
}

export interface ExecResult {
  next?: boolean;
  content?: Part[];
}

export interface Command {
  name: string;
  pattern: string | RegExp;
  priority: number;
  execute: (input: string, args?: string[]) => ExecResult | undefined;
}

export interface IPlugin {
  info: PluginInfo;
  load(): Command[];
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

class PluginWorkspace {
  private plugins: (Omit<IPlugin, 'load'> & { loadTime: number })[] = [];
  private commands: (Command & { plugin: string })[] = [];

  registry(plugin: IPlugin): RegistryResult;
  registry(plugins: IPlugin[]): RegistryResult;

  registry(plugins: IPlugin | IPlugin[]): RegistryResult {
    const result: RegistryResult = {
      ok: true,
      failure: []
    };
    if (!Array.isArray(plugins)) {
      plugins = [plugins];
    }
    plugins.forEach(plugin => {
      try {
        const commands = plugin.load();
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

  process(input: string): ProcessResult[] {
    const processResult: ProcessResult[] = [];

    for (const command of this.commands) {
      if (typeof command.pattern === 'string') {
        command.pattern = new RegExp(command.pattern);
      }
      const result = input.match(command.pattern);
      if (result) {
        const prefix = result[0];
        const execRst = command.execute(input.substring(prefix.length).trim(), result.slice(1));
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
  }

  listPlugin() {
    return this.plugins;
  }
}

export const Workspace = new PluginWorkspace();
