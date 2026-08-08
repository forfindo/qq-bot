import { Wildcard } from '@/utils';
import { SchemaPermission } from '@/schema';

export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: SchemaPermission.Rule[][]
): SchemaPermission.Rule {
  return (
    rulesets
      .flat()
      .findLast(
        rule => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)
      ) ?? {
      action: 'ask',
      permission,
      pattern: '*'
    }
  );
}
