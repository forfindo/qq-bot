import type { MessageEventBase } from '../message/type';

/** 私聊消息事件 */
export interface PrivateMessageEvent extends MessageEventBase<'private'> {
  /** 发送者用户 ID */
  user_id: string;
}
