import { SchemaPermission } from '@/schema';
import { evaluate as evalRule } from './evaluate';
import os from 'os';

const expand = (pattern: string): string => {
  if (pattern.startsWith('~/')) {
    return os.homedir() + pattern.slice(1);
  }
  if (pattern === '~') {
    return os.homedir();
  }
  if (pattern.startsWith('$HOME/')) {
    return os.homedir() + pattern.slice(5);
  }
  if (pattern.startsWith('$HOME')) {
    return os.homedir() + pattern.slice(5);
  }
  return pattern;
};

export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: SchemaPermission.Ruleset[]
): SchemaPermission.Rule {
  return evalRule(permission, pattern, ...rulesets);
}

export function fromConfig(permission: SchemaPermission.Info) {
  const ruleset: SchemaPermission.Ruleset = [];
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === 'string') {
      ruleset.push({ permission: key, action: value, pattern: '*' });
      continue;
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({
        permission: key,
        pattern: expand(pattern),
        action
      }))
    );
  }
  return ruleset;
}

export function merge(...rulesets: SchemaPermission.Ruleset[]): SchemaPermission.Ruleset {
  return rulesets.flat();
}
