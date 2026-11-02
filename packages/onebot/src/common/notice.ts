/** 成员增加事件的子类型 */
export type MemberIncreaseSubType = 'join' | 'invite' | '' | `${string}.${string}`;

/** 成员减少事件的子类型 */
export type MemberDecreaseSubType = 'leave' | 'kick' | '' | `${string}.${string}`;

/** 消息删除事件的子类型 */
export type MessageDeleteSubType = 'recall' | 'delete' | '' | `${string}.${string}`;
