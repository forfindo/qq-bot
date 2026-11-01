/**
 * OneBot 扩展规则。
 *
 * OneBot 允许实现添加扩展字段，扩展字段名**建议**使用 `<prefix>.` 前缀
 * （如 `qq.raw_event_id`），但并非强制要求，值任意。
 */
export interface Extensible {
  [key: string]: unknown;
}
