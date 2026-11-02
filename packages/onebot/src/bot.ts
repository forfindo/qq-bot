import type { Status, VersionInfo } from './connect/status';
import type { MaybePromise } from './connect/utility';
import type { ExtendedEvent, OneBotEvent, RequestEvent } from './event';
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
import type { FriendInfo, GetUserInfoParams, UserInfo } from './user/actions';
import type { MessageEvent } from './event';
import type { MetaEvent } from './meta/events';

/** 拓展action **/
interface ExtensionAction {
  [name: string]: (params: Record<string, unknown>) => MaybePromise<unknown>;
}

/**
 * OneBot 应用端机器人
 */
interface StandardBot {
  /** 消息事件 **/
  on(name: 'message', event: MessageEvent | ExtendedEvent<'message'>): void;

  /** 请求事件 **/
  on(name: 'request', event: RequestEvent | ExtendedEvent<'request'>): void;

  /** 通知事件 **/
  on(name: 'notice', event: RequestEvent | ExtendedEvent<'notice'>): void;

  /** 元事件 **/
  on(name: 'mete', event: MetaEvent | ExtendedEvent<'meta'>): void;

  // -------------------------------------------------------------------------
  // 元动作
  // -------------------------------------------------------------------------

  /** 获取最新事件列表 */
  getLatestEvents(params?: GetLatestEventsParams): MaybePromise<OneBotEvent[]>;

  /** 获取支持的动作列表 */
  getSupportedActions(): MaybePromise<string[]>;

  /** 获取运行状态 */
  getStatus(): MaybePromise<Status>;

  /** 获取版本信息 */
  getVersion(): MaybePromise<VersionInfo>;

  // -------------------------------------------------------------------------
  // 消息动作
  // -------------------------------------------------------------------------

  /** 发送消息 */
  sendMessage(params: SendMessageParams): MaybePromise<SendMessageResult>;

  /** 撤回消息 */
  deleteMessage(params: DeleteMessageParams): MaybePromise<null>;

  // -------------------------------------------------------------------------
  // 用户动作
  // -------------------------------------------------------------------------

  /** 获取机器人自身信息 */
  getSelfInfo(): MaybePromise<UserInfo>;

  /** 获取用户信息 */
  getUserInfo(params: GetUserInfoParams): MaybePromise<FriendInfo>;

  /** 获取好友列表 */
  getFriendList(): MaybePromise<FriendInfo[]>;

  // -------------------------------------------------------------------------
  // 群动作
  // -------------------------------------------------------------------------

  /** 获取群信息 */
  getGroupInfo(params: GetGroupInfoParams): MaybePromise<GroupInfo>;

  /** 获取群列表 */
  getGroupList(): MaybePromise<GroupInfo[]>;

  /** 获取群成员信息 */
  getGroupMemberInfo(params: GetGroupMemberInfoParams): MaybePromise<GroupMemberInfo>;

  /** 获取群成员列表 */
  getGroupMemberList(params: GetGroupMemberListParams): MaybePromise<GroupMemberInfo[]>;

  /** 设置群名称 */
  setGroupName(params: SetGroupNameParams): MaybePromise<null>;

  /** 退出群 */
  leaveGroup(params: LeaveGroupParams): MaybePromise<null>;

  // -------------------------------------------------------------------------
  // 群组动作
  // -------------------------------------------------------------------------

  /** 获取群组信息 */
  getGuildInfo(params: GetGuildInfoParams): MaybePromise<GuildInfo>;

  /** 获取群组列表 */
  getGuildList(): MaybePromise<GuildInfo[]>;

  /** 设置群组名称 */
  setGuildName(params: SetGuildNameParams): MaybePromise<null>;

  /** 获取群组成员信息 */
  getGuildMemberInfo(params: GetGuildMemberInfoParams): MaybePromise<GuildMemberInfo>;

  /** 获取群组成员列表 */
  getGuildMemberList(params: GetGuildMemberListParams): MaybePromise<GuildMemberInfo[]>;

  /** 退出群组 */
  leaveGuild(params: LeaveGuildParams): MaybePromise<null>;

  // -------------------------------------------------------------------------
  // 频道动作
  // -------------------------------------------------------------------------

  /** 获取频道信息 */
  getChannelInfo(params: GetChannelInfoParams): MaybePromise<ChannelInfo>;

  /** 获取频道列表 */
  getChannelList(params: GetChannelListParams): MaybePromise<ChannelInfo[]>;

  /** 设置频道名称 */
  setChannelName(params: SetChannelNameParams): MaybePromise<null>;

  /** 获取频道成员信息 */
  getChannelMemberInfo(params: GetChannelMemberInfoParams): MaybePromise<ChannelMemberInfo>;

  /** 获取频道成员列表 */
  getChannelMemberList(params: GetChannelMemberListParams): MaybePromise<ChannelMemberInfo[]>;

  /** 退出频道 */
  leaveChannel(params: LeaveChannelParams): MaybePromise<null>;

  // -------------------------------------------------------------------------
  // 文件动作
  // -------------------------------------------------------------------------

  /** 上传文件 */
  uploadFile(params: UploadFileParams): MaybePromise<UploadFileResult>;

  /** 分片上传文件 */
  uploadFileFragmented(
    params: UploadFileFragmentedParams
  ): MaybePromise<UploadFileFragmentedResult>;

  /** 获取文件 */
  getFile(params: GetFileParams): MaybePromise<GetFileResult>;

  /** 分片获取文件 */
  getFileFragmented(params: GetFileFragmentedParams): MaybePromise<GetFileFragmentedResult>;
}

export type Bot = StandardBot & ExtensionAction;
