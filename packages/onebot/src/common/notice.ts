/** 允许任意字符串，同时保留字面量提示 */
type SubType<T extends string> = T | (string & {});

/** 成员增加事件的子类型，自定义值建议使用 `命名空间.子类型` 格式 */
export type MemberIncreaseSubType = SubType<'join' | 'invite' | ''>;

/** 成员减少事件的子类型，自定义值建议使用 `命名空间.子类型` 格式 */
export type MemberDecreaseSubType = SubType<'leave' | 'kick' | ''>;

/** 消息删除事件的子类型，自定义值建议使用 `命名空间.子类型` 格式 */
export type MessageDeleteSubType = SubType<'recall' | 'delete' | ''>;
