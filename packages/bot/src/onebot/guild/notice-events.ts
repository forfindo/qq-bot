import type {
  MemberDecreaseSubType,
  MemberIncreaseSubType,
  MessageDeleteSubType
} from '../common/notice';
import type { NonMetaEventBase } from '../connect/event';

/** 群组成员增加事件 */
export interface GuildMemberIncreaseEvent extends NonMetaEventBase<
  'notice',
  'guild_member_increase'
> {
  sub_type: MemberIncreaseSubType;
  /** 群组 ID */
  guild_id: string;
  /** 增加的用户 ID */
  user_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}

/** 群组成员减少事件 */
export interface GuildMemberDecreaseEvent extends NonMetaEventBase<
  'notice',
  'guild_member_decrease'
> {
  sub_type: MemberDecreaseSubType;
  /** 群组 ID */
  guild_id: string;
  /** 减少的用户 ID */
  user_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}

/** 频道成员增加事件 */
export interface ChannelMemberIncreaseEvent extends NonMetaEventBase<
  'notice',
  'channel_member_increase'
> {
  sub_type: MemberIncreaseSubType;
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
  /** 增加的用户 ID */
  user_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}

/** 频道成员减少事件 */
export interface ChannelMemberDecreaseEvent extends NonMetaEventBase<
  'notice',
  'channel_member_decrease'
> {
  sub_type: MemberDecreaseSubType;
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
  /** 减少的用户 ID */
  user_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}

/** 频道消息删除事件 */
export interface ChannelMessageDeleteEvent extends NonMetaEventBase<
  'notice',
  'channel_message_delete'
> {
  sub_type: MessageDeleteSubType;
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
  /** 消息 ID */
  message_id: string;
  /** 消息发送者 ID */
  user_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}

/** 频道新建事件 */
export interface ChannelCreateEvent extends NonMetaEventBase<'notice', 'channel_create'> {
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}

/** 频道删除事件 */
export interface ChannelDeleteEvent extends NonMetaEventBase<'notice', 'channel_delete'> {
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
  /** 操作者的用户 ID */
  operator_id: string;
}
