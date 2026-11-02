import type { ActionResponse } from './connect/action';
import type { Self } from './connect/self';
import type { Status, VersionInfo } from './connect/status';
import type { OneBotEvent } from './event';
import type {
  GetFileFragmentedParams,
  GetFileFragmentedResult,
  GetFileParams,
  GetFileResult,
  UploadFileFragmentedParams,
  UploadFileFragmentedResult,
  UploadFileParams,
  UploadFileResult
} from './file/actions';
import type {
  ChannelInfo,
  ChannelMemberInfo,
  GetChannelInfoParams,
  GetChannelListParams,
  GetChannelMemberInfoParams,
  GetChannelMemberListParams,
  GetGuildInfoParams,
  GetGuildMemberInfoParams,
  GetGuildMemberListParams,
  GuildInfo,
  GuildMemberInfo,
  LeaveChannelParams,
  LeaveGuildParams,
  SetChannelNameParams,
  SetGuildNameParams
} from './guild/actions';
import type {
  GetGroupInfoParams,
  GetGroupMemberInfoParams,
  GetGroupMemberListParams,
  GroupInfo,
  GroupMemberInfo,
  LeaveGroupParams,
  SetGroupNameParams
} from './group/actions';
import type { DeleteMessageParams, SendMessageParams, SendMessageResult } from './message/actions';
import type { GetLatestEventsParams } from './meta/actions';
import type { Extensible } from './rules';
import type { FriendInfo, GetUserInfoParams, UserInfo } from './user/actions';

/**
 * 所有 OneBot 标准动作的参数与响应数据定义。
 *
 * 这是一个接口，OneBot 实现或使用方可以通过声明合并添加扩展动作：
 *
 * ```ts
 * declare module '@xopenbot/bot' {
 *   interface ActionMap {
 *     'qq.get_group_honor_info': ActionDefinition<
 *       { group_id: string },
 *       { honors: string[] }
 *     >;
 *   }
 * }
 * ```
 */
export interface ActionMap {
  get_latest_events: { params: GetLatestEventsParams; result: OneBotEvent[] };
  get_supported_actions: { params: Record<string, never>; result: string[] };
  get_status: { params: Record<string, never>; result: Status };
  get_version: { params: Record<string, never>; result: VersionInfo };
  send_message: { params: SendMessageParams; result: SendMessageResult };
  delete_message: { params: DeleteMessageParams; result: null };
  get_self_info: { params: Record<string, never>; result: UserInfo };
  get_user_info: { params: GetUserInfoParams; result: FriendInfo };
  get_friend_list: { params: Record<string, never>; result: FriendInfo[] };
  get_group_info: { params: GetGroupInfoParams; result: GroupInfo };
  get_group_list: { params: Record<string, never>; result: GroupInfo[] };
  get_group_member_info: { params: GetGroupMemberInfoParams; result: GroupMemberInfo };
  get_group_member_list: { params: GetGroupMemberListParams; result: GroupMemberInfo[] };
  set_group_name: { params: SetGroupNameParams; result: null };
  leave_group: { params: LeaveGroupParams; result: null };
  get_guild_info: { params: GetGuildInfoParams; result: GuildInfo };
  get_guild_list: { params: Record<string, never>; result: GuildInfo[] };
  set_guild_name: { params: SetGuildNameParams; result: null };
  get_guild_member_info: { params: GetGuildMemberInfoParams; result: GuildMemberInfo };
  get_guild_member_list: { params: GetGuildMemberListParams; result: GuildMemberInfo[] };
  leave_guild: { params: LeaveGuildParams; result: null };
  get_channel_info: { params: GetChannelInfoParams; result: ChannelInfo };
  get_channel_list: { params: GetChannelListParams; result: ChannelInfo[] };
  set_channel_name: { params: SetChannelNameParams; result: null };
  get_channel_member_info: { params: GetChannelMemberInfoParams; result: ChannelMemberInfo };
  get_channel_member_list: { params: GetChannelMemberListParams; result: ChannelMemberInfo[] };
  leave_channel: { params: LeaveChannelParams; result: null };
  upload_file: { params: UploadFileParams; result: UploadFileResult };
  upload_file_fragmented: {
    params: UploadFileFragmentedParams;
    result: UploadFileFragmentedResult;
  };
  get_file: { params: GetFileParams; result: GetFileResult };
  get_file_fragmented: {
    params: GetFileFragmentedParams;
    result: GetFileFragmentedResult;
  };
}

/** 所有标准动作名称 */
export type ActionName = keyof ActionMap;

/** 元动作名称 */
export type MetaActionName =
  | 'get_latest_events'
  | 'get_supported_actions'
  | 'get_status'
  | 'get_version';

/** 与机器人平台相关的标准动作名称 */
export type PlatformActionName = Exclude<ActionName, MetaActionName>;

/** 带有动作名与参数类型约束的动作请求 */
export interface StandardActionRequest<A extends ActionName = ActionName> extends Extensible {
  action: A;
  params: ActionMap[A]['params'];
  echo?: string;
  self?: Self;
}

/** 带有动作名与响应数据类型约束的动作响应 */
export type StandardActionResponse<A extends ActionName = ActionName> = ActionResponse<
  ActionMap[A]['result']
>;
