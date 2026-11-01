import type { NonMetaEventBase } from '../connect/event';

/** 好友增加事件 */
export interface FriendIncreaseEvent extends NonMetaEventBase<'notice', 'friend_increase'> {
  /** 增加的用户的用户 ID */
  user_id: string;
}

/** 好友减少事件 */
export interface FriendDecreaseEvent extends NonMetaEventBase<'notice', 'friend_decrease'> {
  /** 减少的用户的用户 ID */
  user_id: string;
}

/** 私聊消息删除事件 */
export interface PrivateMessageDeleteEvent extends NonMetaEventBase<
  'notice',
  'private_message_delete'
> {
  /** 消息 ID */
  message_id: string;
  /** 消息发送者 ID */
  user_id: string;
}
