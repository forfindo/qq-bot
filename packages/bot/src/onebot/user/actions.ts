import type { Extensible } from '../rules';

/** 用户信息 */
export interface UserInfo extends Extensible {
  /** 用户 ID */
  user_id: string;
  /** 用户昵称 */
  user_name: string;
  /** 用户显示名称，如群名片 */
  user_displayname: string;
}

/** 好友信息 */
export interface FriendInfo extends UserInfo {
  /** 好友备注 */
  user_remark: string;
}

/** `get_user_info` 动作的请求参数 */
export interface GetUserInfoParams extends Extensible {
  /** 用户 ID */
  user_id: string;
}
