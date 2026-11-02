import type { Extensible } from '../rules';
import type { UserInfo } from '../user/actions';

/** 群信息 */
export interface GroupInfo extends Extensible {
  /** 群 ID */
  group_id: string;
  /** 群名称 */
  group_name: string;
}

/** 群成员信息 */
export type GroupMemberInfo = UserInfo;

/** `get_group_info` 动作的请求参数 */
export interface GetGroupInfoParams extends Extensible {
  /** 群 ID */
  group_id: string;
}

/** `get_group_member_info` 动作的请求参数 */
export interface GetGroupMemberInfoParams extends Extensible {
  /** 群 ID */
  group_id: string;
  /** 用户 ID */
  user_id: string;
}

/** `get_group_member_list` 动作的请求参数 */
export interface GetGroupMemberListParams extends Extensible {
  /** 群 ID */
  group_id: string;
}

/** `set_group_name` 动作的请求参数 */
export interface SetGroupNameParams extends Extensible {
  /** 群 ID */
  group_id: string;
  /** 新的群名称 */
  group_name: string;
}

/** `leave_group` 动作的请求参数 */
export interface LeaveGroupParams extends Extensible {
  /** 群 ID */
  group_id: string;
}
