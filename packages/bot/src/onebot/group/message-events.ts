import type { MessageEventBase } from '../message/type';

/** 群聊消息事件 */
export interface GroupMessageEvent extends MessageEventBase<'group'> {
  /** 群 ID */
  group_id: string;
  /** 发送者用户 ID */
  user_id: string;
}
