# OneBot 12

`@xopenbot/bot` 的 `src/onebot` 模块提供 OneBot 12 接口的 **TypeScript 类型定义**，
依据 [OneBot 接口定义](https://github.com/botuniverse/onebot/tree/master/specs/interface)
编写。除 `Bot` 抽象基类外，本模块只导出类型：

- `Bot` 抽象基类，声明协议规定的全部标准动作方法；
- 全部标准动作的参数与响应类型（`ActionMap`）；
- 元事件、消息事件、通知事件、请求事件及扩展事件的类型；
- 10 种标准消息段与扩展消息段；
- 动作请求、动作响应、返回码等公共类型。

OneBot 实现端和应用端都可以直接引用这些类型。

## 使用

```ts
import type {
  ActionMap,
  AnyMessageSegment,
  GroupMessageEvent,
  OneBotEvent
} from '@xopenbot/bot';
```

### 消息

```ts
import type { AnyMessageSegment, Message } from '@xopenbot/bot';

// 事件和动作响应中使用消息段数组
const message: AnyMessageSegment[] = [
  { type: 'text', data: { text: '你好' } },
  { type: 'mention', data: { user_id: '10000' } },
  { type: 'image', data: { file_id: 'file-1' } }
];

// 动作请求参数可以使用字符串、单个消息段或消息段数组
const content: Message = '你好';

// 扩展消息段的类型名建议使用 `<prefix>.` 前缀
const face: AnyMessageSegment = {
  type: 'qq.face',
  data: { id: '123' }
};

// 无前缀的扩展消息段类型可以通过声明合并加入 MessageSegmentMap
declare module '@xopenbot/bot' {
  interface MessageSegmentMap {
    face: { id: string };
  }
}
const unprefixedFace: AnyMessageSegment = { type: 'face', data: { id: '123' } };
```

标准消息段：`text`、`mention`、`mention_all`、`image`、`voice`、`audio`、
`video`、`file`、`location`、`reply`。

### 动作

```ts
import type {
  ActionMap,
  ActionRequest,
  ActionResponse,
  SendGroupMessageParams,
  SendMessageResult
} from '@xopenbot/bot';

const params: SendGroupMessageParams = {
  detail_type: 'group',
  group_id: '123456',
  message: '你好'
};

// 参数与响应通过 ActionMap 关联
type Result = ActionMap['send_message']['result'];
// SendMessageResult

// 通用动作请求 / 响应
declare const request: ActionRequest<SendGroupMessageParams>;
declare const response: ActionResponse<SendMessageResult>;

// 带动作名约束的版本
import type { StandardActionRequest, StandardActionResponse } from '@xopenbot/bot';

declare const sendRequest: StandardActionRequest<'send_message'>;
declare const sendResponse: StandardActionResponse<'send_message'>;
```

动作名称：

```ts
import type { ActionName, MetaActionName, PlatformActionName } from '@xopenbot/bot';

type All = ActionName; // 全部 31 个标准动作
type Meta = MetaActionName; // get_latest_events | get_supported_actions | get_status | get_version
type Platform = PlatformActionName; // 除元动作外的标准动作
```

### Bot 抽象类

`Bot` 是应用端的抽象基类，声明了协议规定的全部 31 个标准动作。方法名是动作名的
小驼峰形式，返回值即动作响应中的 `data`，具体实现由子类提供：

```ts
import type { Bot } from '@xopenbot/bot';

declare const bot: Bot;

const info = await bot.getSelfInfo(); // get_self_info
const result = await bot.sendMessage({
  // send_message
  detail_type: 'group',
  group_id: '123456',
  message: '你好'
});

// call 会按约定把动作名转成小驼峰方法名后调用
const status = await bot.call('get_status', {}); // getStatus
const events = await bot.call('get_latest_events', { limit: 100 }); // getLatestEvents
```

纯 JS 可以直接继承 `Bot` 并按需实现动作方法：

```js
import { Bot } from '@xopenbot/bot';

class MyBot extends Bot {
  async getStatus() {
    /* ... */
  }

  async sendMessage(params) {
    /* ... */
  }

  // 其余标准动作...
}
```

扩展动作合并到 `ActionMap` 后，按同样的约定实现对应方法即可通过 `call` 调用。
例如 `qq.get_group_honor_info` 对应方法 `qqGetGroupHonorInfo`：

```ts
declare module '@xopenbot/bot' {
  interface ActionMap {
    'qq.get_group_honor_info': {
      params: { group_id: string };
      result: { honors: string[] };
    };
  }
}

const honor = await bot.call('qq.get_group_honor_info', { group_id: '123456' });
```

建立连接、发送动作请求等具体逻辑由子类实现。

### 事件

事件使用 `type` 和 `detail_type` 作为判别字段，可以直接收窄：

```ts
import type { OneBotEvent } from '@xopenbot/bot';

function handle(event: OneBotEvent): void {
  if (event.type === 'message' && event.detail_type === 'group') {
    event.group_id; // string
    event.user_id; // string
    event.alt_message; // string
  }

  if (event.type === 'notice' && event.detail_type === 'friend_increase') {
    event.user_id; // string
  }
}
```

标准事件：

- `meta.connect`、`meta.heartbeat`、`meta.status_update`
- `message.private`、`message.group`、`message.channel`
- `notice.friend_increase`、`notice.friend_decrease`、
  `notice.private_message_delete`、`notice.group_member_increase`、
  `notice.group_member_decrease`、`notice.group_message_delete`、
  `notice.guild_member_increase`、`notice.guild_member_decrease`、
  `notice.channel_member_increase`、`notice.channel_member_decrease`、
  `notice.channel_message_delete`、`notice.channel_create`、`notice.channel_delete`
- 请求事件与扩展事件可通过扩展字段携带数据

### 返回码

返回码以类型映射的形式提供，不包含运行时常量：

```ts
import type { RetCode, RetCodeMap } from '@xopenbot/bot';

const success: RetCode = 0;
const platformError: RetCode = 34_000;
type PlatformError = RetCodeMap['PlatformError']; // 34000
```

## 扩展

OneBot 允许实现对事件、动作和消息段进行扩展。类型定义提供了三种扩展方式：

- **扩展字段**：所有标准对象都继承 `Extensible`，允许添加任意扩展字段
  （规范建议使用 `<prefix>.` 前缀，但并非强制要求）；
- **声明合并**：`ActionMap`、`MessageSegmentMap`、`RetCodeMap` 都是接口，可以通过
  `declare module '@xopenbot/bot'` 合并实现自定义的类型；
- **扩展事件**：`ExtendedEventOf` 可以组合 `type`、`detail_type` 和自定义字段，
  得到精确的扩展事件类型。

### 扩展字段

```ts
import type { GroupMessageEvent } from '@xopenbot/bot';

const event: GroupMessageEvent = {
  id: 'b6e65187-5ac0-489c-b431-53078e9d2bbb',
  time: 1_700_000_000,
  type: 'message',
  detail_type: 'group',
  sub_type: '',
  self: { platform: 'qq', user_id: '10000' },
  message_id: '1',
  message: [{ type: 'text', data: { text: '你好' } }],
  alt_message: '你好',
  group_id: '123456',
  user_id: '20000',
  'qq.message_scene': 'group',
  raw_event_id: 'abc'
};
```

`Extensible` 使用 `[key: string]: unknown`，字段名不受限制。规范建议扩展字段使用
`<prefix>.` 前缀（如 `qq.message_scene`），但并非强制要求。如果希望无前缀字段
也有精确类型，可以通过接口继承声明：

```ts
interface MyGroupMessageEvent extends GroupMessageEvent {
  raw_event_id: string;
}
```

标准动作参数、动作响应数据、消息段参数、事件、用户/群/频道信息、状态信息等
都支持这种扩展字段。

### 扩展消息段

```ts
import type { AnyMessageSegment, SegmentType } from '@xopenbot/bot';

declare module '@xopenbot/bot' {
  interface MessageSegmentMap {
    'qq.face': { id: string };
  }
}

const face: AnyMessageSegment = { type: 'qq.face', data: { id: '123' } };

// 声明合并后 SegmentType 包含 'qq.face'
const type: SegmentType = 'qq.face';
```

### 扩展动作

```ts
import type { ActionDefinition, ActionMap, ActionName } from '@xopenbot/bot';

declare module '@xopenbot/bot' {
  interface ActionMap {
    'qq.get_group_honor_info': ActionDefinition<
      { group_id: string },
      { honors: string[] }
    >;
  }
}

type Params = ActionMap['qq.get_group_honor_info']['params'];
// { group_id: string }

// 声明合并后 ActionName 包含 'qq.get_group_honor_info'
const action: ActionName = 'qq.get_group_honor_info';
```

`StandardActionRequest<'qq.get_group_honor_info'>` 和
`StandardActionResponse<'qq.get_group_honor_info'>` 也会自动使用扩展动作的参数和
响应类型。

### 扩展事件

`OneBotEvent` 已经包含宽泛的 `ExtendedEvent`，任何扩展事件都可以赋值给它。需要
精确类型时，使用 `ExtendedEventOf`：

```ts
import type { ExtendedEventOf } from '@xopenbot/bot';

type QqGroupFileUploadEvent = ExtendedEventOf<'notice', 'qq.group_file_upload'> & {
  group_id: string;
  file_id: string;
};

const event: QqGroupFileUploadEvent = {
  id: 'event-1',
  time: 1_700_000_000,
  type: 'notice',
  detail_type: 'qq.group_file_upload',
  sub_type: '',
  self: { platform: 'qq', user_id: '10000' },
  group_id: '123456',
  file_id: 'file-1'
};
```

### 扩展返回码

标准返回码是固定值，但 `3xxxx` 的低三位和 `6xxxx`～`9xxxx` 可以由实现自行定义，
可以合并到 `RetCodeMap`：

```ts
import type { RetCode } from '@xopenbot/bot';

declare module '@xopenbot/bot' {
  interface RetCodeMap {
    QqGroupNotFound: 34_101;
  }
}

const code: RetCode = 34_101;
```

## 目录结构

```
packages/bot
├── src
│   ├── index.ts            # 包入口
│   └── onebot
│       ├── index.ts        # 模块入口，导出 Bot 与全部类型
│       ├── bot.ts          # 应用端 Bot 抽象基类
│       ├── action-map.ts   # ActionMap 与标准动作请求/响应
│       ├── event.ts        # 事件联合类型与扩展事件
│       ├── rules.ts        # 扩展字段规则
│       ├── connect         # OneBot Connect 基础类型
│       │   ├── action.ts   # 动作定义、动作请求与响应
│       │   ├── event.ts    # 事件基本类型与公共字段
│       │   ├── retcode.ts  # 返回码类型映射
│       │   ├── self.ts     # 机器人自身标识
│       │   ├── status.ts   # 版本信息与运行状态
│       │   └── utility.ts  # 通用工具类型
│       ├── meta            # 元动作与元事件
│       │   ├── actions.ts
│       │   └── events.ts
│       ├── message         # 消息类型、消息段与消息动作
│       │   ├── actions.ts
│       │   ├── segments.ts
│       │   └── type.ts
│       ├── user            # 用户信息、私聊消息与用户通知事件
│       │   ├── actions.ts
│       │   ├── message-events.ts
│       │   └── notice-events.ts
│       ├── group           # 群信息、群消息与群通知事件
│       │   ├── actions.ts
│       │   ├── message-events.ts
│       │   └── notice-events.ts
│       ├── guild           # 群组/频道信息、消息与通知事件
│       │   ├── actions.ts
│       │   ├── message-events.ts
│       │   └── notice-events.ts
│       ├── file            # 文件动作
│       │   └── actions.ts
│       └── common          # 跨分类公共类型
│           └── notice.ts   # 通知事件子类型
├── rollup.config.js
└── package.json
```

## 构建

```bash
pnpm --filter @xopenbot/bot build
```

类型检查（仓库根目录）：

```bash
pnpm check
```
