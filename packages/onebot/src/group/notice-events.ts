import type {
  MemberDecreaseSubType,
  MemberIncreaseSubType,
  MessageDeleteSubType
} from '../common/notice';
import type { NonMetaEventBase } from '../connect/event';

/** 群成员增加事件 */
export interface GroupMemberIncreaseEvent extends NonMetaEventBase<
  'notice',
  'group_member_increase'
> {
  sub_type: MemberIncreaseSubType;
  /** 群 ID */
  group_id: string;
  /** 增加的成员的用户的用户 ID */
  user_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}

/** 群成员减少事件 */
export interface GroupMemberDecreaseEvent extends NonMetaEventBase<
  'notice',
  'group_member_decrease'
> {
  sub_type: MemberDecreaseSubType;
  /** 群 ID */
  group_id: string;
  /** 减少的成员的用户的用户 ID */
  user_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}

/** 群消息删除事件 */
export interface GroupMessageDeleteEvent extends NonMetaEventBase<
  'notice',
  'group_message_delete'
> {
  sub_type: MessageDeleteSubType;
  /** 群 ID */
  group_id: string;
  /** 消息 ID */
  message_id: string;
  /** 消息发送者 ID */
  user_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}
