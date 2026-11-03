import type { Extensible } from '../rules';
import type { Message } from './type';

/** 发送消息动作的公共参数 */
export interface SendMessageBase extends Extensible {
  /** 消息内容 */
  message: Message;
}

/** 发送私聊消息的请求参数 */
export interface SendPrivateMessageParams extends SendMessageBase {
  detail_type: 'private';
  /** 用户 ID */
  user_id: string;
}

/** 发送群聊消息的请求参数 */
export interface SendGroupMessageParams extends SendMessageBase {
  detail_type: 'group';
  /** 群 ID */
  group_id: string;
}

/** 发送频道消息的请求参数 */
export interface SendChannelMessageParams extends SendMessageBase {
  detail_type: 'channel';
  /** 频道 ID */
  guild_id: string;
  /** 子频道 ID */
  channel_id: string;
}

/** 发送扩展类型消息的请求参数 */
export interface SendExtendedMessageParams {
  /** 扩展的详细类型，建议使用 `<prefix>.<name>` 形式 */
  detail_type: string;
  /** 消息内容 */
  message: Message;
  [key: string]: unknown;
}

/** `send_message` 动作的请求参数 */
export type SendMessageParams =
  | SendPrivateMessageParams
  | SendGroupMessageParams
  | SendChannelMessageParams
  | SendExtendedMessageParams;

/** `send_message` 动作的响应数据 */
export interface SendMessageResult extends Extensible {
  /** 消息 ID */
  message_id: string;
  /** 消息发送时间（Unix 时间戳），单位：秒 */
  time: number;
}

/** `delete_message` 动作的请求参数 */
export interface DeleteMessageParams extends Extensible {
  /** 消息 ID */
  message_id: string;
}
