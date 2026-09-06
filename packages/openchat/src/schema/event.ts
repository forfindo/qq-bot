import { Schema } from 'effect';
import { optionalOmitUndefined, withStatics } from '@/schema/common';
import { ascending } from '@/id/id';

export const ID = Schema.String.check(Schema.isStartsWith('evt_')).pipe(
  Schema.brand('Event.ID'),
  withStatics(schema => ({ create: () => schema.make(ascending('event')) }))
);
export type ID = typeof ID.Type;

export const LocationRef = Schema.Struct({
  uid: Schema.String
}).annotate({ identifier: 'Location.Ref' });
export type LocationRef = Schema.Schema.Type<typeof LocationRef>;

export type Definition<
  Type extends string = string,
  DataSchema extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>
> = Schema.Top & {
  readonly type: Type;
  readonly durable?: {
    readonly version: number;
    readonly aggregate: string;
  };
  readonly data: DataSchema;
};

export type Data<D extends Definition> = Schema.Schema.Type<D['data']>;

export type Payload<D extends Definition = Definition> = {
  readonly id: ID;
  readonly type: D['type'];
  readonly data: Data<D>;
  readonly durable?: {
    readonly aggregateID: string;
    readonly seq: number;
    readonly version: number;
  };
  readonly location?: LocationRef;
  readonly metadata?: Record<string, unknown>;
};

export function define<
  const Type extends string,
  const Fields extends Schema.Codec<unknown, unknown>
>(input: {
  readonly type: Type;
  readonly durable?: {
    readonly version: number;
    readonly aggregate: string;
  };
  readonly schema: Fields;
}) {
  const data = input.schema;
  return Schema.Struct({
    id: ID,
    metadata: optionalOmitUndefined(Schema.Record(Schema.String, Schema.Unknown)),
    type: Schema.Literal(input.type),
    durable: optionalOmitUndefined(
      Schema.Struct({ aggregateID: Schema.String, seq: Schema.Int, version: Schema.Int })
    ),
    location: optionalOmitUndefined(LocationRef),
    data
  })
    .annotate({ identifier: input.type })
    .pipe(
      withStatics(() => ({
        type: input.type,
        ...(input.durable === void 0 ? {} : { durable: input.durable }),
        data
      }))
    ) satisfies Definition<Type, typeof data>;
}

export const inventory = <const Definitions extends ReadonlyArray<Definition>>(
  ...definitions: Definitions
) => {
  return Object.freeze(definitions);
};

// Error
export class InvalidDurableEventError extends Schema.TaggedErrorClass<InvalidDurableEventError>()(
  'EventV2.InvalidDurableEvent',
  {
    type: Schema.String,
    message: Schema.String
  }
) {}
