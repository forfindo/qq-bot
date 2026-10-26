export function isRecord(value: unknown): value is { [key: string]: unknown } {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
