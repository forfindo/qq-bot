# @xopenbot/plugin

xopenbot 的插件工作区。负责插件的加载、命令注册、消息匹配与分发、定时任务调度，以及插件卸载。

一个插件通过 `loadCommand()` 返回若干条命令；命令由 `pattern` 匹配输入，由 `execute` 产出消息内容。`Workspace` 是一个类，需要先 `new` 出一个实例；一个实例管理一组插件、命令、定时任务与插件私有状态，并支持 `init` 向命令上下文注入 API。

## 目录结构

```
packages/plugin
├── src
│   ├── index.ts             # 包入口，统一导出
│   ├── workspace.ts         # 插件工作区、命令注册与分发
│   ├── types
│   │   ├── message-part.ts  # 消息段类型 Part
│   │   └── workspace.ts     # 插件、命令、定时任务等类型定义
│   └── utils
│       ├── merge.ts         # 深层次对象合并
│       └── type-guard.ts    # 类型守卫
├── package.json
├── rollup.config.js         # 构建配置（输出 dist）
└── tsconfig.json
```

## 安装与构建

在仓库根目录安装依赖：

```bash
pnpm install
```

构建与检查：

```bash
# 构建（rollup，输出到 dist）
pnpm --filter @xopenbot/plugin build

# 类型检查（仓库根目录）
pnpm check

# 代码检查（仓库根目录）
pnpm lint
```

## 快速开始

### 1. 编写插件

插件是一个实现了 `IPlugin` 的对象：

```ts
import type { Command, IPlugin } from '@xopenbot/plugin';

export const echoPlugin: IPlugin = {
  info: {
    name: 'echo',
    version: '1.0.0',
    description: '复读机示例'
  },
  loadCommand(): Command[] {
    return [
      {
        name: 'echo',
        // 匹配到的片段会被截掉，剩余部分作为 execute 的 input
        // pattern 未以 ^ 开头时会自动补上 ^（字符串与正则都适用）
        pattern: /^echo\s*/i,
        // 数字越小越先执行（全局按 priority 升序排列）
        priority: 100,
        execute(input) {
          if (!input) {
            return {
              content: [{ type: 'text', text: '用法：echo <内容>' }]
            };
          }
          return {
            content: [{ type: 'text', text: input }]
          };
        }
      }
    ];
  }
};
```

### 2. 注册插件

```ts
import { Workspace } from '@xopenbot/plugin';
import { echoPlugin } from './plugins/echo';

const workspace = new Workspace(bot);
const result = await workspace.registry(echoPlugin);

if (!result.ok) {
  console.error('插件加载失败：', result.failure);
}
```

`registry` 也支持一次注册多个插件：

```ts
await workspace.registry(echoPlugin, anotherPlugin);
```

单个插件加载抛错不会影响其他插件注册，错误会记录在 `result.failure` 中。

### 3. 处理消息

```ts
const outputs = await workspace.process('echo 你好', {});

// [
//   {
//     plugin: 'echo',
//     name: 'echo',
//     content: [{ type: 'text', text: '你好' }]
//   }
// ]
```

返回值的 `content` 是 `Part[]`，如何转换成 QQ 消息由调用方决定。`process` 的第二个参数是额外的消息上下文，会合并进命令 `execute` 的 `ctx`；但 `logger`、`bot`、`state` 由工作区强制覆盖，传入的同名键不会生效。

命令默认在第一个命中后停止匹配，只有 `execute` 返回 `{ next: true }` 时才会继续尝试后续命令，最终的返回值会是多个命令结果的数组。

`execute` 的第三个参数是 `pattern` 的捕获组（`result.slice(1)`）：

```ts
{
  pattern: /^set\s+(\w+)\s+(.+)$/i,
  execute(input, ctx, args) {
    const [key, value] = args ?? [];
    return { content: [{ type: 'text', text: `${key}=${value}` }] };
  }
}
```

### 4. 卸载插件

```ts
workspace.deregister('echo');
```

`deregister` 按插件的 `info.name` 删除该插件的插件信息、全部命令、`init` 注入的 API 与该插件的 `state`，并取消它的所有定时任务。重复注册同名插件时会先自动执行一次 `deregister`，因此插件状态会重置。注意：当前 `loadListener` 注册的回调不会被 `deregister` 清理。

### 5. 定时任务

插件可以实现 `loadSchedule()` 返回要注册的定时任务，`cron` 使用标准 cron 表达式：

```ts
import type { IPlugin, ScheduleTask } from '@xopenbot/plugin';

const reminderPlugin: IPlugin = {
  info: { name: 'reminder', version: '1.0.0', description: '定时提醒' },
  loadCommand() {
    return [];
  },
  loadSchedule(): ScheduleTask[] {
    return [
      {
        name: 'daily',
        cron: '0 0 9 * * *',
        task(fireDate) {
          // 返回 true 表示执行成功，false 表示失败
          console.log('触发时间：', fireDate);
          return true;
        }
      }
    ];
  }
};

const workspace = new Workspace(bot);
await workspace.registry(reminderPlugin);
```

任务以 `插件名_任务名` 作为唯一标识；同名任务不会重复注册，非法 `cron` 会记录错误并跳过。

`Workspace` 的构造器第一个参数是 `bot`（会作为 `ctx.bot` 传给每个插件），第二个参数可以传入一个 logger；不传时会依次回退到 `bot.logger`、`console`。定时任务执行的成功/失败会记录到它：

```ts
const workspace = new Workspace(bot, logger);
```

## 插件上下文（ctx）

插件的 `init` / `loadCommand` / `loadSchedule` / `loadListener` 以及命令的 `execute` 都会收到一个 `ctx`，包含：

- `logger`：`LikeLogger`，工作区注入的日志对象；
- `bot`：构造 `Workspace` 时传入的 bot 实例；
- `state`：该插件专属的状态对象，跨命令/定时任务持久，重复注册同名插件会重置。

```ts
loadCommand(ctx) {
  ctx.state.count = 0;   // 初始化状态
  return [...];
}

execute(input, ctx) {
  ctx.state.count += 1;
  return { content: [{ type: 'text', text: `已执行 ${ctx.state.count} 次` }] };
}
```

## init

插件可以定义 `init(ctx)` 返回一些 API，这些 API 会合并进所有插件命令 `execute` 时的 `ctx`。合并顺序为：`init` API → `process` 传入的额外上下文 → 工作区保留字段（`logger` / `bot` / `state`），后者会覆盖前者：

```ts
init(ctx) {
  return { db: new Database(ctx.state) };
}
```

## 消息段（Part）

`ExecResult.content` 与 `ProcessResult.content` 都是 `Part[]`，目前支持两种消息段：

```ts
// 文本
{ type: 'text', text: '你好' }

// 图片：path 为必填，content 为可选的补充内容（如 base64）
{ type: 'image', path: 'https://example.com/a.png' }
```

## 查询已注册插件

```ts
const plugins = workspace.listPlugin();
// [{ name: 'echo', version: '1.0.0', description: '复读机示例', loadTime: 1700000000000 }]
```

## 事件监听

插件可以实现 `loadListener()` 返回 `Record<事件名, 回调>`，工作区会收集这些回调，但目前**尚未提供事件派发入口**，因此回调不会被触发。

```ts
loadListener() {
  return {
    message: ctx => {
      ctx.logger.debug('收到消息');
    }
  };
}
```
