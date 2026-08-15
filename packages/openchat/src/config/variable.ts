import { Flag, type FlagKey } from '@/flag';
import { Global } from '@/utils';
import path from 'path';
import { InvalidError } from '@/config/error';
import { Effect } from 'effect';
import { AppFileSystem } from '@/file';

type ParseSource =
  | {
      type: 'path';
      path: string;
    }
  | {
      type: 'virtual';
      source: string;
      dir: string;
    };

type SubstituteInput = ParseSource & {
  text: string;
  missing?: 'error' | 'empty';
};

function source(input: ParseSource) {
  return input.type === 'path' ? input.path : input.source;
}

function dir(input: ParseSource) {
  return input.type === 'path' ? path.dirname(input.path) : input.dir;
}

/** Apply {env:VAR} and {file:path} substitutions to config text. */
export const substitute = Effect.fnUntraced(function* (input: SubstituteInput) {
  const fs = yield* AppFileSystem.Service;

  const missing = input.missing ?? 'error';
  const text = input.text.replace(/\{env:([^}]+)\}/g, (_, varName: string) => {
    return Flag[varName as FlagKey]?.toString() || '';
  });

  const fileMatches = Array.from(text.matchAll(/\{file:[^}]+\}/g));
  if (!fileMatches.length) {
    return text;
  }

  const configDir = dir(input);
  const configSource = source(input);
  let out = '';
  let cursor = 0;

  for (const match of fileMatches) {
    const token = match[0];
    const index = match.index;
    out += text.slice(cursor, index);

    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const prefix = text.slice(lineStart, index).trimStart();
    if (prefix.startsWith('//')) {
      out += token;
      cursor = index + token.length;
      continue;
    }

    let filePath = token.replace(/^\{file:/, '').replace(/\}$/, '');
    if (filePath.startsWith('~/')) {
      filePath = path.join(Global.Path.home, filePath.slice(2));
    }

    if (configDir.startsWith('http')) {
      yield* Effect.fail(
        new InvalidError({
          path: configDir,
          message: `{file:${configSource}} does not support network addresses`
        })
      );
    }
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath);
    const fileContent = yield* fs.readFileString(resolvedPath, 'utf-8').pipe(
      missing === 'empty'
        ? Effect.orElseSucceed(() => '')
        : Effect.mapError(error => {
            const errMsg = `bad file reference: "${token}"`;
            if (error.reason._tag === 'NotFound') {
              return new InvalidError(
                {
                  path: configSource,
                  message: errMsg + ` ${resolvedPath} does not exist`
                },
                { cause: error }
              );
            }
            return new InvalidError({ path: configSource, message: errMsg }, { cause: error });
          })
    );
    out += JSON.stringify(fileContent.trim()).slice(1, -1);
    cursor = index + token.length;
  }

  out += text.slice(cursor);
  return out;
});
