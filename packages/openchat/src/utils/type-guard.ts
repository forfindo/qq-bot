import type { JSONSchema7 } from '@ai-sdk/provider';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isJsonSchema(value: unknown): value is JSONSchema7 {
  return typeof value === 'boolean' || isRecord(value);
}

export function isNonFiniteNumber(value: unknown) {
  return value === 'NaN' || value === 'Infinity' || value === '-Infinity';
}

export function typeSafeParse(input: string) {
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch (_) {
    return void 0;
  }
}
