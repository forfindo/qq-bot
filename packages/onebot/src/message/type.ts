import type { NonMetaEventBase } from '../connect/event';
import type { AnyMessageSegment } from './segments';

/** 消息内容：纯文本、单个消息段或消息段数组 */
export type Message = string | AnyMessageSegment | AnyMessageSegment[];

/** 消息段数组 */
export type MessageSegmentArray = AnyMessageSegment[];

/** 二进制数据，OneBot 中以 Base64 编码的字符串表示 */
export type Bytes = string;

/** 消息事件共有的消息字段 */
export interface MessageEventBase<D extends string> extends NonMetaEventBase<'message', D> {
  /** 消息 ID */
  message_id: string;
  /** 消息内容 */
  message: AnyMessageSegment[];
  /** 消息内容的纯文本表示 */
  alt_message: string;
}
