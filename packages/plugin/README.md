# @xopenbot/plugin

openbot 的插件工作区。它负责插件的加载、命令注册、消息匹配与分发，以及插件卸载。

一个插件通过 `load()` 返回若干条命令；命令由 `pattern` 匹配输入，由 `execute` 产出消息内容。`Workspace` 是一个类，需要先 `new` 出一个实例；一个实例管理一组插件、命令与定时任务。

## 目录结构

```
packages/plugin
├── src
│   ├── index.ts             # 包入口，统一导出
│   ├── workspace.ts         # 插件工作区、命令注册与分发
│   └── types
│       ├── message-part.ts  # 消息段类型 Part
│       └── workspace.ts     # 插件、命令、定时任务等类型定义
├── package.json
└── rollup.config.js
```

## 安装与构建

在仓库根目录安装依赖：

```bash
pnpm install
```

开发阶段通过 workspace 直接引用源码（`main` 指向 `src/index.ts`）：

```jsonc
// packages/bot/package.json
{
  "dependencies": {
    "@xopenbot/plugin": "workspace:*"
  }
}
```

构建与检查：

```bash
# 构建（rollup，输出到 dist）
pnpm --filter @openbot/plugin build

# 类型检查（仓库根目录）
pnpm check

# 代码检查（仓库根目录）
pnpm lint
```

## 快速开始

### 1. 编写插件

插件是一个实现了 `IPlugin` 的对象：

```ts
import type { Command, IPlugin } from '@openbot/plugin';

export const echoPlugin: IPlugin = {
  info: {
    name: 'echo',
    version: '1.0.0',
    description: '复读机示例'
  },
  load(): Command[] {
    return [
      {
        name: 'echo',
        // 会先匹配 '^echo'，剩下的部分作为 execute 的 input
        pattern: /^echo\s*/i,
        // 数字越小越先执行
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
import { Workspace } from '@openbot/plugin';
import { echoPlugin } from './plugins/echo';

const workspace = new Workspace();
const result = workspace.registry(echoPlugin);

if (!result.ok) {
  console.error('插件加载失败：', result.failure);
}
```

`registry` 也支持一次注册多个插件：

```ts
workspace.registry(echoPlugin, anotherPlugin);
```

单个插件在 `load()` 阶段抛错不会影响其他插件注册，错误会记录在 `result.failure` 中。

### 3. 处理消息

```ts
const outputs = await workspace.process('echo 你好');

// [
//   {
//     plugin: 'echo',
//     name: 'echo',
//     content: [{ type: 'text', text: '你好' }]
//   }
// ]
```

返回值的 `content` 是 `Part[]`，如何转换成 QQ 消息由调用方决定。

### 4. 卸载插件

```ts
workspace.deregister('echo');
```

`deregister` 按插件的 `info.name` 删除该插件注册的全部命令，并取消它的所有定时任务。

### 5. 定时任务

插件可以实现 `getScheduleTask()` 返回要注册的定时任务，`cron` 使用标准 cron 表达式：

```ts
import type { IPlugin, ScheduleTask } from '@openbot/plugin';

const reminderPlugin: IPlugin = {
  info: { name: 'reminder', version: '1.0.0', description: '定时提醒' },
  load() {
    return [];
  },
  getScheduleTask(): ScheduleTask[] {
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

const workspace = new Workspace();
workspace.registry(reminderPlugin);
```

`Workspace` 的构造器可以传入一个 logger（默认 `console`），定时任务执行的成功/失败会记录到它：

```ts
const workspace = new Workspace(logger);
```