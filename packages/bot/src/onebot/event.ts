import type { Self } from './connect/self';
import type { EventBase, EventType, NonMetaEventBase } from './connect/event';
import type {
  ChannelCreateEvent,
  ChannelDeleteEvent,
  ChannelMemberDecreaseEvent,
  ChannelMemberIncreaseEvent,
  ChannelMessageDeleteEvent,
  GuildMemberDecreaseEvent,
  GuildMemberIncreaseEvent
} from './guild/notice-events';
import type { ChannelMessageEvent } from './guild/message-events';
import type {
  GroupMemberDecreaseEvent,
  GroupMemberIncreaseEvent,
  GroupMessageDeleteEvent
} from './group/notice-events';
import type { GroupMessageEvent } from './group/message-events';
import type { MetaEvent } from './meta/events';
import type {
  FriendDecreaseEvent,
  FriendIncreaseEvent,
  PrivateMessageDeleteEvent
} from './user/notice-events';
import type { PrivateMessageEvent } from './user/message-events';

/** 消息事件 */
export type MessageEvent = PrivateMessageEvent | GroupMessageEvent | ChannelMessageEvent;

/** 通知事件 */
export type NoticeEvent =
  | FriendIncreaseEvent
  | FriendDecreaseEvent
  | PrivateMessageDeleteEvent
  | GroupMemberIncreaseEvent
  | GroupMemberDecreaseEvent
  | GroupMessageDeleteEvent
  | GuildMemberIncreaseEvent
  | GuildMemberDecreaseEvent
  | ChannelMemberIncreaseEvent
  | ChannelMemberDecreaseEvent
  | ChannelMessageDeleteEvent
  | ChannelCreateEvent
  | ChannelDeleteEvent;

/** 请求事件。标准中暂未定义具体的请求事件，实现可通过扩展字段携带数据 */
export type RequestEvent = NonMetaEventBase<'request', string> & Record<string, unknown>;

/**
 * 扩展事件。
 *
 * OneBot 实现可以扩展事件的具体类型（`detail_type`），扩展的类型名建议使用
 * `<prefix>.` 前缀。扩展事件仍须包含事件的基本字段。
 *
 * 可以指定 `type` 和 `detail_type` 得到更精确的定义：
 *
 * ```ts
 * type QqGroupFileUploadEvent = ExtendedEventOf<'notice', 'qq.group_file_upload'> & {
 *   group_id: string;
 *   file_id: string;
 * };
 * ```
 */
export type ExtendedEventOf<
  T extends EventType = EventType,
  D extends `${string}.${string}` = `${string}.${string}`
> = EventBase<T, D> & {
  self?: Self;
  [key: string]: unknown;
};

/** 未指定具体类型的扩展事件 */
export type ExtendedEvent = ExtendedEventOf;

/** 所有标准事件与扩展事件的联合类型 */
export type OneBotEvent = MetaEvent | MessageEvent | NoticeEvent | RequestEvent | ExtendedEvent;

/** 除元事件外的标准事件 */
export type NonMetaEvent = MessageEvent | NoticeEvent | RequestEvent;
