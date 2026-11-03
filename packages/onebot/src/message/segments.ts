import type { Extensible } from '../rules';

/** `text` 纯文本消息段 */
export interface TextSegmentData extends Extensible {
  /** 纯文本内容 */
  text: string;
}

/** `mention` 提及消息段 */
export interface MentionSegmentData extends Extensible {
  /** 提及的用户 ID */
  user_id: string;
}

/** `mention_all` 提及所有人消息段，无参数 */
export type MentionAllSegmentData = Extensible;

/** `image` 图片消息段 */
export interface ImageSegmentData extends Extensible {
  /** 图片文件 ID */
  file_id: string;
}

/** `voice` 语音消息段 */
export interface VoiceSegmentData extends Extensible {
  /** 语音文件 ID */
  file_id: string;
}

/** `audio` 音频消息段 */
export interface AudioSegmentData extends Extensible {
  /** 音频文件 ID */
  file_id: string;
}

/** `video` 视频消息段 */
export interface VideoSegmentData extends Extensible {
  /** 视频文件 ID */
  file_id: string;
}

/** `file` 文件消息段 */
export interface FileSegmentData extends Extensible {
  /** 文件 ID */
  file_id: string;
}

/** `location` 位置消息段 */
export interface LocationSegmentData extends Extensible {
  /** 纬度 */
  latitude: number;
  /** 经度 */
  longitude: number;
  /** 标题 */
  title: string;
  /** 地址内容 */
  content: string;
}

/** `reply` 回复消息段 */
export interface ReplySegmentData extends Extensible {
  /** 回复的消息 ID */
  message_id: string;
  /** 回复的消息发送者 ID，发送时可以不传入 */
  user_id?: string;
}

/**
 * 标准消息段类型到消息段数据的映射。
 *
 * OneBot 实现或应用可以扩展消息段类型，通过声明合并补充：
 *
 * ```ts
 * declare module '@xopenbot/bot' {
 *   interface MessageSegmentMap {
 *     'qq.custom': { foo: string };
 *   }
 * }
 * ```
 */
export interface MessageSegmentMap {
  text: TextSegmentData;
  mention: MentionSegmentData;
  mention_all: MentionAllSegmentData;
  image: ImageSegmentData;
  voice: VoiceSegmentData;
  audio: AudioSegmentData;
  video: VideoSegmentData;
  file: FileSegmentData;
  location: LocationSegmentData;
  reply: ReplySegmentData;
}

/** 标准消息段类型 */
export type SegmentType = keyof MessageSegmentMap;

/** 标准消息段 */
export type StandardMessageSegment<T extends SegmentType = SegmentType> = {
  type: T;
  data: MessageSegmentMap[T];
};

/** 扩展消息段，类型名建议使用 `<prefix>.<name>` 形式 */
export type ExtensionMessageSegment = MessageSegment<string>;

/**
 * 任意消息段。
 *
 * 已知的消息段类型会得到精确的数据类型，其他类型的数据为普通对象。
 */
export type MessageSegment<T extends string = SegmentType> = T extends SegmentType
  ? StandardMessageSegment<T>
  : { type: T; data: Record<string, unknown> };

/** 任意标准或扩展消息段 */
export type AnyMessageSegment = StandardMessageSegment | ExtensionMessageSegment;
