/**
 * OneBot 动作响应返回码。
 *
 * 标准返回码为固定值；`3xxxx` 的低三位和 `6xxxx`～`9xxxx` 可以由 OneBot 实现
 * 自行定义，可以通过声明合并补充：
 *
 * ```ts
 * declare module '@xopenbot/bot' {
 *   interface RetCodeMap {
 *     QqGroupNotFound: 34_101;
 *   }
 * }
 * ```
 *
 * 该映射只提供类型，具体数值可通过 `RetCodeMap['PlatformError']` 引用。
 */
export interface RetCodeMap {
  /** 成功 */
  OK: 0;
  /** 无效的动作请求 */
  BadRequest: 10_001;
  /** 不支持的动作请求 */
  UnsupportedAction: 10_002;
  /** 无效的动作请求参数 */
  BadParam: 10_003;
  /** 不支持的动作请求参数 */
  UnsupportedParam: 10_004;
  /** 不支持的消息段类型 */
  UnsupportedSegment: 10_005;
  /** 无效的消息段参数 */
  BadSegmentData: 10_006;
  /** 不支持的消息段参数 */
  UnsupportedSegmentData: 10_007;
  /** 未指定机器人账号 */
  WhoAmI: 10_101;
  /** 未知的机器人账号 */
  UnknownSelf: 10_102;
  /** 动作处理器实现错误 */
  BadHandler: 20_001;
  /** 动作处理器运行时抛出异常 */
  InternalHandlerError: 20_002;
  /** 数据库错误 */
  DatabaseError: 31_000;
  /** 文件系统错误 */
  FilesystemError: 32_000;
  /** 网络错误 */
  NetworkError: 33_000;
  /** 机器人平台错误 */
  PlatformError: 34_000;
  /** 动作逻辑错误 */
  LogicError: 35_000;
  /** 我不想干了 */
  IAmTired: 36_000;
}

/** OneBot 动作响应返回码 */
export type RetCode = RetCodeMap[keyof RetCodeMap];
