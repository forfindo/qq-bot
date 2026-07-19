import { type ParseError as JsoncParseError, parse as parseJsoncImpl, printParseErrorCode } from 'jsonc-parser';
import { Cause, Effect, Exit, Schema as EffectSchema, SchemaIssue } from 'effect';
import type { DeepMutable } from '@/schema/common';
import { InvalidError, JsonError } from './error';

export const jsonc = Effect.fnUntraced(function* (text: string, filepath: string) {
  const errors: JsoncParseError[] = [];
  const data: unknown = parseJsoncImpl(text, errors, { allowTrailingComma: true });
  if (errors.length) {
    const lines = text.split('\n');
    const issues = errors
      .map(e => {
        const beforeOffset = text.substring(0, e.offset).split('\n');
        const line = beforeOffset.length;
        const column = beforeOffset[beforeOffset.length - 1]!.length + 1;
        const problemLine = lines[line - 1];

        const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`;
        if (!problemLine) {
          return error;
        }

        return `${error}\n   Line ${line}: ${problemLine}\n${''.padStart(column + 9)}^`;
      })
      .join('\n');
    yield* Effect.fail(
      new JsonError({
        path: filepath,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${issues}\n--- End ---`
      })
    );
  }
  return data;
});

export const schema = Effect.fnUntraced(function* <S extends EffectSchema.Decoder<unknown, never>>(schema: S, data: unknown, source: string) {
  const decoded = EffectSchema.decodeUnknownExit(schema)(data, {
    errors: 'all',
    propertyOrder: 'original',
    onExcessProperty: 'error'
  });
  if (Exit.isSuccess(decoded)) {
    return decoded.value! as DeepMutable<S['Type']>;
  }
  const error = Cause.squash(decoded.cause);
  return yield* Effect.fail(
    new InvalidError(
      {
        path: source,
        issues: EffectSchema.isSchemaError(error)
          ? SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map(issue => ({
              ...issue,
              message: issue.message,
              path: issue.path?.map(String) ?? []
            }))
          : [{ message: String(error), path: [] }]
      },
      { cause: error }
    )
  );
});
