import { Wildcard } from '@/utils';

type Rule = {
  permission: string;
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
};

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  return (
    rulesets.flat().findLast(rule => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: 'ask',
      permission,
      pattern: '*'
    }
  );
}
