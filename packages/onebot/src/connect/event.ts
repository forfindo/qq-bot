import type { Extensible } from '../rules';
import type { Self } from './self';

/** 事件基本类型 */
export type EventType = 'meta' | 'message' | 'notice' | 'request';

/** 除元事件外的事件类型 */
export type NonMetaEventType = Exclude<EventType, 'meta'>;

/** 所有事件共有的字段 */
export interface EventBase<
  T extends EventType = EventType,
  D extends string = string
> extends Extensible {
  /** 事件唯一标识符 */
  id: string;
  /** 事件发生时间（Unix 时间戳），单位：秒 */
  time: number;
  type: T;
  detail_type: D;
  /** 事件子类型（详细类型的下一级类型），没有定义时为空字符串 */
  sub_type: string;
}

/** 除元事件外的所有事件共有的字段 */
export interface NonMetaEventBase<
  T extends NonMetaEventType = NonMetaEventType,
  D extends string = string
> extends EventBase<T, D> {
  /** 机器人自身标识 */
  self: Self;
}
