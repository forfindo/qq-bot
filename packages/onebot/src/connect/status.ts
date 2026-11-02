import type { Extensible } from '../rules';
import type { Self } from './self';

/** OneBot 实现版本信息，与 `get_version` 动作响应数据一致 */
export interface VersionInfo extends Extensible {
  /** OneBot 实现名称 */
  impl: string;
  /** OneBot 实现的版本号 */
  version: string;
  /** OneBot 实现的 OneBot 标准版本号 */
  onebot_version: string;
}

/** 单个机器人账号的状态 */
export interface BotStatus extends Extensible {
  self: Self;
  /** 机器人账号是否在线（可收发消息等） */
  online: boolean;
}

/** OneBot 实现运行状态，与 `get_status` 动作响应数据一致 */
export interface Status extends Extensible {
  /** 是否各项状态都符合预期 */
  good: boolean;
  /** 当前 OneBot Connect 连接上所有机器人账号的状态列表 */
  bots: BotStatus[];
}
