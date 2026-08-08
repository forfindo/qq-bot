import { SchemaPermission } from '@/schema';
import { evaluate as evalRule } from './evaluate';

export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: SchemaPermission.Ruleset[]
): SchemaPermission.Rule {
  return evalRule(permission, pattern, ...rulesets);
}
