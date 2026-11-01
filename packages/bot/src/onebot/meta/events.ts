import type { EventBase } from '../connect/event';
import type { Status, VersionInfo } from '../connect/status';

/** 连接事件，在 OneBot Connect 连接建立后发送 */
export interface MetaConnectEvent extends EventBase<'meta', 'connect'> {
  /** OneBot 实现版本信息 */
  version: VersionInfo;
}

/** 心跳事件，定期发送以表明 OneBot 实现仍在运行 */
export interface MetaHeartbeatEvent extends EventBase<'meta', 'heartbeat'> {
  /** 心跳间隔时间（毫秒） */
  interval: number;
}

/** 状态更新事件，OneBot 实现状态发生变化时发送 */
export interface MetaStatusUpdateEvent extends EventBase<'meta', 'status_update'> {
  /** 新的运行状态 */
  status: Status;
}

/** 元事件 */
export type MetaEvent = MetaConnectEvent | MetaHeartbeatEvent | MetaStatusUpdateEvent;
