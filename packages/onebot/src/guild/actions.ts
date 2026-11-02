import type { Extensible } from '../rules';
import type { UserInfo } from '../user/actions';

/** 群组信息 */
export interface GuildInfo extends Extensible {
  /** 群组 ID */
  guild_id: string;
  /** 群组名称 */
  guild_name: string;
}

/** 群组成员信息 */
export type GuildMemberInfo = UserInfo;

/** 频道信息 */
export interface ChannelInfo extends Extensible {
  /** 频道 ID */
  channel_id: string;
  /** 频道名称 */
  channel_name: string;
}

/** 频道成员信息 */
export type ChannelMemberInfo = UserInfo;

/** `get_guild_info` 动作的请求参数 */
export interface GetGuildInfoParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
}

/** `set_guild_name` 动作的请求参数 */
export interface SetGuildNameParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
  /** 新的群组名称 */
  guild_name: string;
}

/** `get_guild_member_info` 动作的请求参数 */
export interface GetGuildMemberInfoParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
  /** 用户 ID */
  user_id: string;
}

/** `get_guild_member_list` 动作的请求参数 */
export interface GetGuildMemberListParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
}

/** `leave_guild` 动作的请求参数 */
export interface LeaveGuildParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
}

/** `get_channel_info` 动作的请求参数 */
export interface GetChannelInfoParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
}

/** `get_channel_list` 动作的请求参数 */
export interface GetChannelListParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
  /** 只获取机器人账号已加入的频道列表，默认 `false` */
  joined_only?: boolean;
}

/** `set_channel_name` 动作的请求参数 */
export interface SetChannelNameParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
  /** 新的频道名称 */
  channel_name: string;
}

/** `get_channel_member_info` 动作的请求参数 */
export interface GetChannelMemberInfoParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
  /** 用户 ID */
  user_id: string;
}

/** `get_channel_member_list` 动作的请求参数 */
export interface GetChannelMemberListParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
}

/** `leave_channel` 动作的请求参数 */
export interface LeaveChannelParams extends Extensible {
  /** 群组 ID */
  guild_id: string;
  /** 频道 ID */
  channel_id: string;
}
