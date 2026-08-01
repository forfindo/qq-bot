import { AppFileSystem } from '@/file-system';
import { Effect } from 'effect';
import matter from 'gray-matter';
import { FrontmatterError } from '@/config/error';

// other coding agents like claude code allow invalid yaml in their
// frontmatter, we need to fallback to a more permissive parser for those cases
export function fallbackSanitization(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) {
    return content;
  }

  const frontmatter = match[1];
  const lines = frontmatter.split(/\r?\n/);
  const result: string[] = [];

  for (const line of lines) {
    // skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') {
      result.push(line);
      continue;
    }

    // skip lines that are continuations (indented)
    if (line.match(/^\s+/)) {
      result.push(line);
      continue;
    }

    // match key: value pattern
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!kvMatch?.[2]) {
      result.push(line);
      continue;
    }

    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    // skip if value is empty, already quoted, or uses block scalar
    if (
      value === '' ||
      value === '>' ||
      value === '|' ||
      value.startsWith('"') ||
      value.startsWith("'")
    ) {
      result.push(line);
      continue;
    }

    // if value contains a colon, convert to block scalar
    if (value.includes(':')) {
      result.push(`${key}: |-`);
      result.push(`  ${value}`);
      continue;
    }

    result.push(line);
  }

  const processed = result.join('\n');
  return content.replace(frontmatter, () => processed);
}

export const parse = Effect.fn('ConfigMarkdown.parse')(function* (filePath: string) {
  const fs = yield* AppFileSystem.Service;

  const template = yield* fs.readFileString(filePath);

  return yield* Effect.sync(() => matter(template)).pipe(
    Effect.catchCause(() =>
      Effect.try({
        try: () => matter(fallbackSanitization(template)),
        catch: err =>
          new FrontmatterError(
            {
              path: filePath,
              message: `${filePath}: Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`
            },
            { cause: err }
          )
      })
    )
  );
});
