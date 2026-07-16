export function match(str: string, pattern: string) {
  if (str) {
    str = str.replaceAll('\\', '/');
  }
  if (pattern) {
    pattern = pattern.replaceAll('\\', '/');
  }
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special regex chars
    .replace(/\*/g, '.*') // * becomes .*
    .replace(/\?/g, '.'); // ? becomes .

  // If pattern ends with " *" (space + wildcard), make the trailing part optional
  // This allows "ls *" to match both "ls" and "ls -la"
  if (escaped.endsWith(' .*')) {
    escaped = escaped.slice(0, -3) + '( .*)?';
  }

  const flags = process.platform === 'win32' ? 'si' : 's';
  return new RegExp('^' + escaped + '$', flags).test(str);
}
