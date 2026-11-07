# @xopenbot/sandbox

`@xopenbot/sandbox` 是一个在受限环境中执行 JavaScript 的沙箱包，用于让群聊消息直接作为代码执行，同时限制代码对宿主进程和机器人能力的访问。

项目来源于 [takayamabot](https://github.com/takayama-lily/takayamabot.git)。

## 目录结构

```
packages/sandbox
├── src
│   ├── index.ts          # 包入口：进程管理、事件派发、API 回传
│   ├── bridge.ts         # 子进程：事件解析、注入 API、结果回传、逃逸加固
│   ├── sandbox.ts        # VM 上下文创建、权限代理、执行与持久化
│   ├── sandbox.code.js   # 在沙箱内部执行的初始化代码
│   └── global.d.ts       # 第三方库类型补充
├── dist                  # 构建产物（tsc 输出）
├── package.json
└── tsconfig.json
```

## 工作原理

整体是「宿主进程 + 子进程 + VM 上下文」三层结构：

```
宿主进程 (index.ts)
   │  收到 QQ 事件
   │  normalize() 净化数据
   ▼
子进程 (bridge.ts, fork 启动)
   │  事件转成 JS 源码
   ▼
VM 上下文 (sandbox.ts + sandbox.code.js)
   │  执行代码
   └─ 返回结果 / 需要调用机器人 API 时通过 IPC 回传宿主
```

### 1. 进程隔离

`index.ts` 通过 `child_process.fork` 启动 `bridge.js`，所有用户代码都在子进程中运行：

- 子进程崩溃或退出时由宿主自动重启（`worker.on('exit', startWorker)`）；
- 子进程与宿主通过 IPC 消息通信，消息类型分为：
  - `CallApiRequest`：沙箱请求宿主调用机器人 API；
  - `ExecResponse`：执行结果需要回传到 QQ；
  - `init` / `saveCtx`：初始化与持久化指令。
- `process.on('disconnect')` 时子进程主动退出，避免孤儿进程。

即使沙箱被突破，影响范围也先被限制在子进程内。

### 2. VM 上下文隔离

`sandbox.ts` 使用 Node 内置 `vm` 模块创建独立上下文，并关闭 `codeGeneration` 的字符串与 WebAssembly 能力，同时把微任务设置为在每次求值后统一执行。上下文对象本身是一个 `Proxy`，用于拦截属性写入、删除、原型修改等操作。初始化流程为：

1. 从 `data/context`、`data/context.fn`（brotli 压缩）还原上次的上下文与函数；
2. 执行 `sandbox.code.js` 注入沙箱内置变量与权限模型；
3. 冻结全部内置对象及其原型；
4. 执行用户可选的 `afterInit()` 钩子。

### 3. 事件驱动执行

`bridge.ts` 不提供显式的「执行某个函数」接口，而是把收到的 QQ 消息转换为 JavaScript 源码：

- 文本消息直接拼接；
- `@`、图片等消息段转换为 CQ 码字符串；
- 通过 `sandbox.run(message)` 在上下文中求值，结果回传到 QQ；
- 消息以 `\` 或 `＼` 开头时进入调试模式，错误信息会带上行号。

### 4. 上下文持久化

沙箱内的普通数据与函数会被序列化保存：

- `context`：普通数据，JSON 序列化后 brotli 压缩；
- `context.fn`：函数被保存为源码字符串，重启时通过 `vm.runInContext` 还原；
- 保存时机：每 60 分钟、调用 `saveCtx()`、子进程以退出码 200 退出时；
- 数据目录由环境变量 `dataPath` 决定，默认 `./data`。

### 5. 异步任务与限流

`bridge.ts` 向沙箱注入的 `setTimeout` / `fetch` 等异步能力都经过限制，主要分两部分。

#### 调用频率限制：`checkFrequency`

`bridge.ts` 以「触发事件的用户」为粒度做频率控制，`precheck`（调用机器人 API 前）、`setTimeout` 和 `fetch.request` 都会先执行它：

- 计数按 `data.user_id` 分桶，每个桶记录最近一次调用时间与次数；
- 相邻调用间隔都在 300ms 内时计数累加，最多 3 次，第 4 次抛出 `调用频率太快。`；
- 距离上次调用超过 300ms 时桶被删除，计数清零。

#### 异步任务递归检测：`checkAndAddAsyncQueue`

`bridge.ts` 用于防止用户通过回调反复发起异步任务形成「无限递归」。任务按 `self.user_id`、`group_id`、`user_id` 组成的队列隔离，并记录任务的结束时间：

- 登记任务时写入一条 `end_time` 为空的记录；
- 回调执行完成后由 `asyncCallback` 写入 `end_time`；
- 已结束超过 500ms 的记录会被清理，仍在进行中的任务会维持队列的 `start_moment`；
- 若同一队列连续繁忙超过 60 秒，抛出 `判定为递归调用，中断。` 并重置 `start_moment`。

#### `setTimeout` 限制

`setTimeout` 不参与上面的繁忙窗口检测，改用独立的任务计数和句柄管理：

- 返回自增数字 id，不再向沙箱暴露宿主 `Timeout` 对象；`clearTimeout` 接收这个 id；
- 延迟必须在 5000ms 到 `2^31 - 1` 之间；
- 同一事件同时存活的 timer 最多 3 个，超限抛出 `setTimeout调用次数达到上限`；
- 每个会话最多 64 个、全局最多 1024 个活跃 timer；
- timer 触发或被 `clearTimeout` 后释放计数，供后续调度使用。

此外还有：

- HTTP 响应体限制 500KB，避免内存耗尽；
- 输出内容经过敏感词过滤。

## 阻止逃逸的方法

> 说明：Node 的 `vm` 本身**不是**安全边界，本包通过多层加固显著提高逃逸成本，但仍建议在低权限用户或容器中运行不可信代码。

### 1. 禁止动态代码生成

`codeGeneration.strings = false` 与 `wasm: false` 直接禁用了以下逃逸入口：

- `eval` / `new Function`；
- `WebAssembly`；
- 基于字符串的编译能力。

同时在 `sandbox.code.js` 中删除了 `globalThis` 与 `console`，减少用户拿到全局对象与调试通道的机会。

### 2. 冻结内置对象与原型

`sandbox.ts` 遍历并冻结了 `Object`、`Function`、`Array`、`Promise`、`Proxy`、`Reflect`、`WebAssembly`、各类 TypedArray 等全部内置构造器及其 `prototype`。这样可以阻止用户通过修改原型链获得额外的构造能力。

### 3. 上下文 Proxy 拦截危险操作

上下文对象被包装为 `Proxy`，非主人用户无法进行以下操作：

- 给受保护属性赋值（`protected_properties` 中的项）；
- 修改 `data`、`set_history_allowed`；
- `defineProperty` / `deleteProperty` / `setPrototypeOf` / `preventExtensions`；
- 通过原型修改绕过写入检查。

### 4. 冻结注入的外部对象

`contextify()` 会递归冻结注入到沙箱的对象，并通过一个已处理列表避免循环引用导致死循环。注入的 `data`、`$`、`fetch`、`Buffer`、`path`、`os` 等都被冻结，避免用户改写宿主对象或顺藤摸瓜拿到宿主引用。

### 5. 输入净化

`index.ts` 在把事件送进子进程前执行 `normalize()`，逐项检查事件字段：只保留字符串、数字、布尔、`null`、数组与纯对象，丢弃函数、Symbol、类实例等可能携带宿主信息的值，并排除字段引用回事件自身的情况。

### 6. 主进程侧加固

`bridge.ts` 在完成注入后，对宿主 realm 的 `Function`、`Object` 再做一次加固：把 `Function.prototype.constructor` 替换为一个调用或构造时直接抛错的 `Proxy`，并冻结 `Object`、`Object.prototype`、`Function`、`Function.prototype`。由于注入的宿主函数（如 `Buffer`、`path.join`）可以通过原型链访问到宿主的 `Function` 构造器，这一步可以阻断「拿注入函数当跳板构造新函数」的逃逸路径。

### 7. 权限模型

- `master`：主人 QQ 列表，只有主人可以修改受保护属性；
- `protected_properties`：默认保护 `master`、`afterInit`、`beforeExec`、`afterExec`、`onEvents`、`beforeApiCalled`；
- `database`：按群隔离，只有当前群或主人可以读写；
- `set_history`：只在内部允许写入时记录变量修改历史；
- `run()`：只有主人可以调用，且执行的是**宿主侧** `eval`，完全绕过沙箱。

### 8. 超时与资源限制

- `vm.runInContext` 默认 500ms 超时，防止死循环占满 CPU；
- 异步任务、调用频率、响应体大小均有上限；
- 子进程异常退出后自动重启。

## 使用方式

### 安装与构建

在仓库根目录：

```bash
pnpm install
pnpm --filter @xopenbot/sandbox build
```

构建会执行 `tsc`，并把 `src/sandbox.code.js` 复制到 `dist`。

类型检查与代码检查：

```bash
pnpm check
pnpm lint
```

### 初始化

包只导出三个方法：

```ts
import { init, exec, saveCtx } from '@xopenbot/sandbox';
import type { Bot, MessageEvent } from '@xopenbot/onebot';

declare const bot: Bot;

await init(bot, {
  /** 主人 QQ 列表 */
  master: ['10001'],
  /** 上下文存档目录，默认 ./data */
  dataPath: './data'
});

bot.on('message', (event: MessageEvent) => {
  exec(event);
});
```

注意：

- `init` 只需要调用一次，重复调用会打印错误并忽略；
- `master` 必须是字符串数组，`bridge` 会将其拼接为逗号分隔的字符串；
- 每个机器人实例以 `self.user_id` 为键注册，`exec` 遇到未初始化的机器人会抛错；
- `config.dataPath` 会在子进程收到 `init` 后写入 `process.env.dataPath`，但 `sandbox` 模块已在子进程启动时完成导入，因此实际生效的是**启动前**的环境变量；需要自定义目录时请在启动宿主进程前设置 `dataPath` 环境变量。

### 派发事件

```ts
init(bot, { master: ['10001'] });

bot.on('message', event => exec(event));
bot.on('notice', event => exec(event));
bot.on('request', event => exec(event));
```

`exec` 内部会：

1. 校验机器人是否已初始化；
2. `normalize()` 净化事件数据；
3. 通过 IPC 发送给子进程。

### 手动保存上下文

```ts
saveCtx();
```

立即把当前上下文与函数源码压缩写入 `data/context`、`data/context.fn`。

### 沙箱内执行示例

群成员发送的消息会被当作 JavaScript 表达式执行：

```text
1 + 1          -> 2
Math.max(1,9)  -> 9
this.data.user_id
```

调试模式（以 `\` 开头）会返回带行号的错误：

```text
\ foo.bar
```

在消息中可以使用沙箱注入的能力：

```js
// 发送群消息
$.sendGroupMsg(this.data.group_id, 'hello');

// 私聊
$.sendPrivateMsg('10001', 'hello');

// 获取当前群信息
$.getGroupInfo();

// 发起 HTTP 请求（注意沙箱内没有 console）
fetch('https://example.com', res => {
  this.last_response = res;
});
fetch.post('https://example.com/api', { a: 1 }, res => {
  this.last_response = res;
});

// 延时任务（5000ms ~ 2^31-1），返回数字 id
const timer = setTimeout(() => {
  $.sendGroupMsg(this.data.group_id, 'later');
}, 5000);

// 需要时用同一个 id 取消
clearTimeout(timer);
```

### 沙箱内置 API

`bridge.ts` 通过 `sandbox.include()` 注入以下能力：

| 名称 | 说明 |
| --- | --- |
| `$` | 机器人 API：`sendPrivateMsg`、`sendGroupMsg`、`sendDiscussMsg`、`deleteMsg`、`getGroupInfo`、`ajax`、`get` |
| `fetch` | HTTP 请求，支持 `fetch.get`、`fetch.post`、`fetch.request` |
| `setTimeout` / `clearTimeout` | 受限的延时任务；`setTimeout` 返回数字 id，`clearTimeout` 接收该 id |
| `crypto` | Node `crypto` 模块 |
| `path` | Node `path` 模块 |
| `os` | Node `os` 模块 |
| `zip` / `unzip` | `zlib.deflateSync` / `zlib.unzipSync` |
| `Buffer` | Node `Buffer` |
| `run` | 仅主人可用，在宿主侧 `eval` 任意代码 |

### 沙箱上下文

`sandbox.code.js` 定义了五个主要变量：

| 变量 | 说明 |
| --- | --- |
| `this.master` | 主人 QQ 列表（字符串），受保护 |
| `this.data` | 当前事件数据（环境变量），只读替换 |
| `this.database` | 群数据库，按群隔离 |
| `this.set_history` | 变量修改历史 |
| `this.protected_properties` | 受保护属性列表，受保护 |

常用判断与工具：

```js
this.isMaster();        // 当前用户是否主人
this.isProtected('master'); // 属性是否受保护
this.database[this.data.group_id].foo = 1;
```

### 钩子函数

沙箱支持以下钩子，默认均受保护（只有主人可修改）：

| 钩子 | 触发时机 |
| --- | --- |
| `afterInit()` | 沙箱加载完成 |
| `beforeExec(code)` | 用户代码执行前，可返回字符串替换待执行代码 |
| `afterExec(res)` | 用户代码执行后，可返回新结果 |
| `onEvents()` | 每个 QQ 事件 |
| `beforeApiCalled(params)` | 调用机器人 API 前 |

示例：

```js
this.beforeExec = code => {
  // 记录执行前的代码
  return code;
};

this.afterExec = res => {
  return res + ' (done)';
};
```

### 持久化文件

```
data
├── context      # brotli 压缩的上下文数据
└── context.fn   # brotli 压缩的函数源码
```

函数以源码字符串保存，因此沙箱内定义的函数在重启后可以恢复；超出 10MB 的对象会在保存时被丢弃。

## 注意事项

- 该沙箱依赖 Node `vm`，并非强安全边界，请勿直接运行完全不可信的代码；
- 建议在容器、低权限用户或独立进程中部署，并限制网络与文件访问；
- 主人可用的 `run()` 会在宿主侧执行任意代码，务必只把可信 QQ 加入 `master`；
- 输出与 HTTP 内容会经过敏感词过滤，但仍建议在业务层做额外审核。
