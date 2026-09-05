import type { JSONSchema7 } from '@ai-sdk/provider';
import { JsonSchema, Schema } from 'effect';
import { SchemaTool } from '@/schema';
import { TypeGuard } from '@/utils/index';

type JsonObject = Record<string, unknown>;
const cache = new WeakMap<Schema.Top, JSONSchema7>();

export function fromSchema(schema: Schema.Top): JSONSchema7 {
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }

  const document = Schema.toJsonSchemaDocument(schema, { additionalProperties: true });
  const result = normalize({
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    ...document.schema,
    ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {})
  });
  const inlined = dropDefinitionsIfResolved(inlineLocalReferences(result));
  if (!TypeGuard.isJsonSchema(inlined)) {
    throw new Error('tool JSON Schema helper produced a non-schema value');
  }
  cache.set(schema, inlined);
  return inlined;
}

export function fromTool(tool: SchemaTool.Def): JSONSchema7 {
  return tool.jsonSchema ?? fromSchema(tool.parameters);
}

function normalize(value: unknown, options: { stripNull?: boolean } = {}): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalize(item));
  }
  if (!TypeGuard.isRecord(value)) {
    return value;
  }

  const required = Array.isArray(value.required)
    ? new Set(value.required.filter(item => typeof item === 'string'))
    : void 0;
  const schema = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'properties' && TypeGuard.isRecord(item)
        ? Object.fromEntries(
            Object.entries(item).map(([name, property]) => [
              name,
              normalize(property, { stripNull: !required?.has(name) })
            ])
          )
        : normalize(item)
    ])
  );

  if (schema.additionalProperties === true) {
    delete schema.additionalProperties;
  }

  if (options.stripNull && Array.isArray(schema.anyOf)) {
    const withoutNull = schema.anyOf.filter(
      item => !TypeGuard.isRecord(item) || item.type !== 'null'
    );
    if (withoutNull.length !== schema.anyOf.length) {
      return normalize({ ...schema, anyOf: withoutNull });
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const withoutNull = schema.anyOf;
    const number: unknown = withoutNull.find(
      item => TypeGuard.isRecord(item) && item.type === 'number'
    );
    const nonFinite = withoutNull.filter(
      item =>
        TypeGuard.isRecord(item) &&
        Array.isArray(item.enum) &&
        item.enum.every(entry => TypeGuard.isNonFiniteNumber(entry))
    );
    if (number && nonFinite.length === withoutNull.length - 1) {
      const { anyOf: _, ...rest } = schema;
      return normalize({ ...number, ...rest });
    }

    if (isEmptyStructUnion(withoutNull)) {
      const { anyOf: _, ...rest } = schema;
      return normalize({ type: 'object', properties: {}, ...rest });
    }

    if (withoutNull.length === 1 && TypeGuard.isRecord(withoutNull[0])) {
      const { anyOf: _, ...rest } = schema;
      return normalize({ ...withoutNull[0], ...rest });
    }
  }

  if (
    Array.isArray(schema.allOf) &&
    schema.allOf.every(TypeGuard.isRecord) &&
    canFlattenAllOf(schema.allOf, schema)
  ) {
    const { allOf, ...rest } = schema;
    return normalize({ ...Object.assign({}, ...allOf), ...rest });
  }

  if (schema.type === 'integer' && schema.maximum === void 0) {
    return { minimum: Number.MIN_SAFE_INTEGER, ...schema, maximum: Number.MAX_SAFE_INTEGER };
  }

  return schema;
}

function isEmptyStructUnion(items: unknown[]) {
  return (
    items.length === 2 &&
    items.some(
      item => TypeGuard.isRecord(item) && item.type === 'object' && item.properties === void 0
    ) &&
    items.some(item => TypeGuard.isRecord(item) && item.type === 'array' && item.items === void 0)
  );
}

function canFlattenAllOf(allOf: JsonObject[], parent: JsonObject) {
  const keys = new Set(Object.keys(parent).filter(key => key !== 'allOf'));
  return allOf.every(item =>
    Object.keys(item).every(key => {
      if (keys.has(key)) {
        return false;
      }
      keys.add(key);
      return true;
    })
  );
}

function inlineLocalReferences(
  value: unknown,
  definitions?: JsonObject,
  seen = new Set<string>()
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => inlineLocalReferences(item, definitions, seen));
  }
  if (!TypeGuard.isRecord(value)) {
    return value;
  }

  const localDefinitions = definitions ?? (TypeGuard.isRecord(value.$defs) ? value.$defs : void 0);
  if (typeof value.$ref === 'string' && localDefinitions) {
    const name =
      value.$ref.match(/^#\/\$defs\/(.+)$/)?.[1] ?? value.$ref.match(/^#\/definitions\/(.+)$/)?.[1];
    if (name && !seen.has(name)) {
      const target = localDefinitions[name];
      if (target) {
        const { $ref: _, ...rest } = value;
        return inlineLocalReferences(
          { ...(TypeGuard.isRecord(target) ? target : {}), ...rest },
          localDefinitions,
          new Set(seen).add(name)
        );
      }
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      inlineLocalReferences(item, localDefinitions, seen)
    ])
  );
}

function dropDefinitionsIfResolved(value: unknown): unknown {
  if (!TypeGuard.isRecord(value) || hasLocalReference(value)) {
    return value;
  }
  const { $defs: _, definitions: __, ...rest } = value;
  return rest;
}

function hasLocalReference(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasLocalReference);
  }
  if (!TypeGuard.isRecord(value)) {
    return false;
  }
  if (
    typeof value.$ref === 'string' &&
    (value.$ref.startsWith('#/$defs/') || value.$ref.startsWith('#/definitions/'))
  ) {
    return true;
  }
  return Object.values(value).some(hasLocalReference);
}
