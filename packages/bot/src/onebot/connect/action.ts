import type { Extensible } from '../rules';
import type { Self } from './self';

/** 单个动作的定义：请求参数与响应数据 */
export interface ActionDefinition<Params = Record<string, unknown>, Result = unknown> {
  params: Params;
  result: Result;
}

export interface ActionRequest<P = Record<string, unknown>> extends Extensible {
  /** 动作名称，如 `send_message` */
  action: string;
  /** 动作参数 */
  params: P;
  /** 用于唯一标识一个动作请求，响应中原样返回 */
  echo?: string;
  /** 机器人自身标识 */
  self?: Self;
}

export interface ActionResponse<T = unknown> extends Extensible {
  /** 执行状态（成功与否） */
  status: 'ok' | 'failed';
  retcode: number;
  data: T;
  /** 错误信息，执行成功时应为空字符串 */
  message: string;
  echo?: string;
}
