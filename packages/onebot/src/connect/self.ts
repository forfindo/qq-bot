import type { Extensible } from '../rules';

/** 机器人自身标识，用于在一个 OneBot Connect 连接上唯一标识一个机器人账号 */
export interface Self extends Extensible {
  /** 机器人平台名称 */
  platform: string;
  /** 机器人用户 ID */
  user_id: string;
}
