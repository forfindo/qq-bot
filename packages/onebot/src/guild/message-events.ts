import type { MessageEventBase } from '../message/type';

/** 频道消息事件 */
export interface ChannelMessageEvent extends MessageEventBase<'channel'> {
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
  /** 发送者用户 ID */
  user_id: string;
}
