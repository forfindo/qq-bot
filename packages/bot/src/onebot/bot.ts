import type { ActionMap, ActionName } from './action-map';
import type { Status, VersionInfo } from './connect/status';
import type { MaybePromise } from './connect/utility';
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
import type { FriendInfo, GetUserInfoParams, UserInfo } from './user/actions';

/**
 * 动作名到方法名的约定：下划线和点号分隔转为小驼峰。
 *
 * 例如 `send_message` → `sendMessage`，`qq.get_group_honor_info` →
 * `qqGetGroupHonorInfo`。
 */
function toMethodName(action: string): string {
  return action.replace(/[_.]([a-z])/g, (_, char: string) => char.toUpperCase());
}

/**
 * OneBot 应用端机器人抽象基类。
 *
 * 定义了协议规定的全部标准动作，方法名由动作名称转换为小驼峰形式，
 * 返回值即动作响应中的 `data`。具体实现由子类提供。
 *
 * 扩展动作可以通过声明合并补充到 `ActionMap`，之后就能用 `call` 调用；
 * 也可以直接合并 `Bot` 类添加方法：
 *
 * ```ts
 * declare module '@xopenbot/bot' {
 *   interface Bot {
 *     getGroupHonorInfo(params: { group_id: string }): Promise<{ honors: string[] }>;
 *   }
 * }
 * ```
 */
export abstract class Bot {
  /**
   * 调用任意 OneBot 动作，并返回动作响应中的 `data`。
   *
   * 按约定把动作名转为小驼峰方法名后调用，如 `send_message` 会调用
   * {@link Bot.sendMessage}。扩展动作需要在子类中实现对应的方法后才能通过
   * `call` 调用。
   */
  call<A extends ActionName>(
    action: A,
    params: ActionMap[A]['params']
  ): MaybePromise<ActionMap[A]['result']> {
    const method = toMethodName(action) as keyof this;
    return (
      this[method] as (params: ActionMap[A]['params']) => MaybePromise<ActionMap[A]['result']>
    )(params);
  }

  // -------------------------------------------------------------------------
  // 元动作
  // -------------------------------------------------------------------------

  /** 获取最新事件列表 */
  abstract getLatestEvents(params?: GetLatestEventsParams): MaybePromise<OneBotEvent[]>;

  /** 获取支持的动作列表 */
  abstract getSupportedActions(): MaybePromise<string[]>;

  /** 获取运行状态 */
  abstract getStatus(): MaybePromise<Status>;

  /** 获取版本信息 */
  abstract getVersion(): MaybePromise<VersionInfo>;

  // -------------------------------------------------------------------------
  // 消息动作
  // -------------------------------------------------------------------------

  /** 发送消息 */
  abstract sendMessage(params: SendMessageParams): MaybePromise<SendMessageResult>;

  /** 撤回消息 */
  abstract deleteMessage(params: DeleteMessageParams): MaybePromise<null>;

  // -------------------------------------------------------------------------
  // 用户动作
  // -------------------------------------------------------------------------

  /** 获取机器人自身信息 */
  abstract getSelfInfo(): MaybePromise<UserInfo>;

  /** 获取用户信息 */
  abstract getUserInfo(params: GetUserInfoParams): MaybePromise<FriendInfo>;

  /** 获取好友列表 */
  abstract getFriendList(): MaybePromise<FriendInfo[]>;

  // -------------------------------------------------------------------------
  // 群动作
  // -------------------------------------------------------------------------

  /** 获取群信息 */
  abstract getGroupInfo(params: GetGroupInfoParams): MaybePromise<GroupInfo>;

  /** 获取群列表 */
  abstract getGroupList(): MaybePromise<GroupInfo[]>;

  /** 获取群成员信息 */
  abstract getGroupMemberInfo(params: GetGroupMemberInfoParams): MaybePromise<GroupMemberInfo>;

  /** 获取群成员列表 */
  abstract getGroupMemberList(params: GetGroupMemberListParams): MaybePromise<GroupMemberInfo[]>;

  /** 设置群名称 */
  abstract setGroupName(params: SetGroupNameParams): MaybePromise<null>;

  /** 退出群 */
  abstract leaveGroup(params: LeaveGroupParams): MaybePromise<null>;

  // -------------------------------------------------------------------------
  // 群组动作
  // -------------------------------------------------------------------------

  /** 获取群组信息 */
  abstract getGuildInfo(params: GetGuildInfoParams): MaybePromise<GuildInfo>;

  /** 获取群组列表 */
  abstract getGuildList(): MaybePromise<GuildInfo[]>;

  /** 设置群组名称 */
  abstract setGuildName(params: SetGuildNameParams): MaybePromise<null>;

  /** 获取群组成员信息 */
  abstract getGuildMemberInfo(params: GetGuildMemberInfoParams): MaybePromise<GuildMemberInfo>;

  /** 获取群组成员列表 */
  abstract getGuildMemberList(params: GetGuildMemberListParams): MaybePromise<GuildMemberInfo[]>;

  /** 退出群组 */
  abstract leaveGuild(params: LeaveGuildParams): MaybePromise<null>;

  // -------------------------------------------------------------------------
  // 频道动作
  // -------------------------------------------------------------------------

  /** 获取频道信息 */
  abstract getChannelInfo(params: GetChannelInfoParams): MaybePromise<ChannelInfo>;

  /** 获取频道列表 */
  abstract getChannelList(params: GetChannelListParams): MaybePromise<ChannelInfo[]>;

  /** 设置频道名称 */
  abstract setChannelName(params: SetChannelNameParams): MaybePromise<null>;

  /** 获取频道成员信息 */
  abstract getChannelMemberInfo(
    params: GetChannelMemberInfoParams
  ): MaybePromise<ChannelMemberInfo>;

  /** 获取频道成员列表 */
  abstract getChannelMemberList(
    params: GetChannelMemberListParams
  ): MaybePromise<ChannelMemberInfo[]>;

  /** 退出频道 */
  abstract leaveChannel(params: LeaveChannelParams): MaybePromise<null>;

  // -------------------------------------------------------------------------
  // 文件动作
  // -------------------------------------------------------------------------

  /** 上传文件 */
  abstract uploadFile(params: UploadFileParams): MaybePromise<UploadFileResult>;

  /** 分片上传文件 */
  abstract uploadFileFragmented(
    params: UploadFileFragmentedParams
  ): MaybePromise<UploadFileFragmentedResult>;

  /** 获取文件 */
  abstract getFile(params: GetFileParams): MaybePromise<GetFileResult>;

  /** 分片获取文件 */
  abstract getFileFragmented(
    params: GetFileFragmentedParams
  ): MaybePromise<GetFileFragmentedResult>;
}
