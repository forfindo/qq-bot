export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function typeSafeParse(input: string) {
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch (_) {
    return undefined;
  }
}
