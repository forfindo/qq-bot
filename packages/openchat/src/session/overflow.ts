import { SchemaConfig, SchemaMessage, SchemaProvider } from '@/schema';
import { ProviderTransform } from '@/provider';

const COMPACTION_BUFFER = 20_000;

export function usable(input: { cfg: SchemaConfig.Info; model: SchemaProvider.Model }) {
  const context = input.model.limit.context;
  if (context === 0) {
    return 0;
  }

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model));
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model));
}

export function isOverflow(input: {
  cfg: SchemaConfig.Info;
  tokens: SchemaMessage.Assistant['tokens'];
  model: SchemaProvider.Model;
}) {
  if (input.cfg.compaction?.auto === false) {
    return false;
  }
  if (input.model.limit.context === 0) {
    return false;
  }

  const count =
    input.tokens.total ||
    input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write;
  return count >= usable(input);
}
