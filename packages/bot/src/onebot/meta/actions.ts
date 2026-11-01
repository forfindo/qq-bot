import type { Extensible } from '../rules';

/** `get_latest_events` 动作的请求参数 */
export interface GetLatestEventsParams extends Extensible {
  /** 获取的事件数量上限，默认 0 表示不限制 */
  limit?: number;
  /** 等待事件的最长时间（秒），0 表示不等待 */
  timeout?: number;
}
