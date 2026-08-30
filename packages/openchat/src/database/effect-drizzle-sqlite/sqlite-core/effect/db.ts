import type { QueryEffectHKTBase } from 'drizzle-orm/effect-core/query-effect';
import { entityKind } from 'drizzle-orm/entity';
import type { AnyRelations, EmptyRelations } from 'drizzle-orm/relations';
import type { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core/dialect';
import type { SQLiteEffectSession, SQLiteEffectTransaction } from './session';
import { SQLiteEffectRelationalQueryBuilder } from './query';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core/table';
import { Effect } from 'effect';
import type { MutationOption } from 'drizzle-orm/cache/core/cache';
import { QueryBuilder, type SelectedFields, type WithBuilder } from 'drizzle-orm/sqlite-core';
import { type ColumnsSelection, sql, type SQL, type SQLWrapper } from 'drizzle-orm/sql/sql';
import type { TypedQueryBuilder } from 'drizzle-orm/query-builders/query-builder';
import { WithSubquery } from 'drizzle-orm/subquery';
import { SelectionProxyHandler } from 'drizzle-orm/selection-proxy';
import type { EffectCacheShape } from 'drizzle-orm/cache/core/cache-effect';
import type { SQLiteViewBase } from 'drizzle-orm/sqlite-core/view-base';
import { SQLiteEffectCountBuilder } from './count';
import { SQLiteEffectSelectBuilder } from './select';
import { SQLiteEffectInsertBuilder } from './insert';
import { SQLiteEffectUpdateBuilder } from './update';
import { SQLiteEffectDeleteBase } from './delete';
import type { SQLiteTransactionConfig } from 'drizzle-orm/sqlite-core/session';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import { SQLiteEffectRaw } from './raw';

export class SQLiteEffectDatabase<
  TEffectHKT extends QueryEffectHKTBase,
  TRunResult,
  TRelations extends AnyRelations = EmptyRelations
> {
  static readonly [entityKind]: string = 'SQLiteEffectDatabase';

  declare readonly _: {
    readonly relations: TRelations;
    readonly session: SQLiteEffectSession<TEffectHKT, TRunResult, TRelations>;
  };

  query: {
    [K in keyof TRelations]: SQLiteEffectRelationalQueryBuilder<
      TRelations,
      TRelations[K],
      TEffectHKT
    >;
  };

  constructor(
    /** @internal */
    readonly dialect: SQLiteAsyncDialect,
    /** @internal */
    readonly session: SQLiteEffectSession<TEffectHKT, TRunResult, TRelations>,
    relations: TRelations,
    readonly rowModeRQB?: boolean,
    readonly forbidJsonb?: boolean
  ) {
    this._ = {
      relations,
      session
    };

    this.query = {} as (typeof this)['query'];
    for (const [tableName, relation] of Object.entries(relations)) {
      (this.query as SQLiteEffectDatabase<TEffectHKT, TRunResult, AnyRelations>['query'])[
        tableName
      ] = new SQLiteEffectRelationalQueryBuilder(
        relations,
        relations[relation.name]!.table as SQLiteTable,
        relation,
        dialect,
        session,
        rowModeRQB,
        forbidJsonb
      );
    }

    this.$cache = {
      invalidate: (_params: MutationOption) => Effect.void
    };
  }

  $with: WithBuilder = (alias: string, selection?: ColumnsSelection) => {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const as = (
      qb:
        | TypedQueryBuilder<ColumnsSelection | undefined>
        | SQL
        | ((qb: QueryBuilder) => TypedQueryBuilder<ColumnsSelection | undefined> | SQL)
    ) => {
      if (typeof qb === 'function') {
        qb = qb(new QueryBuilder(self.dialect));
      }

      return new Proxy(
        new WithSubquery(
          qb.getSQL(),
          selection ??
            ('getSelectedFields' in qb
              ? ((qb as { getSelectedFields(): SelectedFields | undefined }).getSelectedFields() ??
                {})
              : {}),
          alias,
          true
        ),
        new SelectionProxyHandler({ alias, sqlAliasedBehavior: 'alias', sqlBehavior: 'error' })
      );
    };
    return { as };
  };

  $cache: { invalidate: EffectCacheShape['onMutate'] };

  $count(source: SQLiteTable | SQLiteViewBase | SQL | SQLWrapper, filters?: SQL<unknown>) {
    return new SQLiteEffectCountBuilder({ source, filters, session: this.session });
  }

  with(...queries: WithSubquery[]) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    function select(): SQLiteEffectSelectBuilder<undefined, TRunResult, TEffectHKT>;
    function select<TSelection extends SelectedFields>(
      fields: TSelection
    ): SQLiteEffectSelectBuilder<TSelection, TRunResult, TEffectHKT>;
    function select(
      fields?: SelectedFields
    ): SQLiteEffectSelectBuilder<SelectedFields | undefined, TRunResult, TEffectHKT> {
      return new SQLiteEffectSelectBuilder({
        fields: fields ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries
      });
    }

    function selectDistinct(): SQLiteEffectSelectBuilder<undefined, TRunResult, TEffectHKT>;
    function selectDistinct<TSelection extends SelectedFields>(
      fields: TSelection
    ): SQLiteEffectSelectBuilder<TSelection, TRunResult, TEffectHKT>;
    function selectDistinct(
      fields?: SelectedFields
    ): SQLiteEffectSelectBuilder<SelectedFields | undefined, TRunResult, TEffectHKT> {
      return new SQLiteEffectSelectBuilder({
        fields: fields ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries,
        distinct: true
      });
    }

    function update<TTable extends SQLiteTable>(
      table: TTable
    ): SQLiteEffectUpdateBuilder<TTable, TRunResult, TEffectHKT> {
      return new SQLiteEffectUpdateBuilder(table, self.session, self.dialect, queries);
    }

    function insert<TTable extends SQLiteTable>(
      into: TTable
    ): SQLiteEffectInsertBuilder<TTable, TRunResult, TEffectHKT> {
      return new SQLiteEffectInsertBuilder(into, self.session, self.dialect, queries);
    }

    function delete_<TTable extends SQLiteTable>(
      from: TTable
    ): SQLiteEffectDeleteBase<TTable, TRunResult, undefined, false, never, TEffectHKT> {
      return new SQLiteEffectDeleteBase(from, self.session, self.dialect, queries);
    }

    return { select, selectDistinct, update, insert, delete: delete_ };
  }

  select(): SQLiteEffectSelectBuilder<undefined, TRunResult, TEffectHKT>;
  select<TSelection extends SelectedFields>(
    fields: TSelection
  ): SQLiteEffectSelectBuilder<TSelection, TRunResult, TEffectHKT>;
  select(
    fields?: SelectedFields
  ): SQLiteEffectSelectBuilder<SelectedFields | undefined, TRunResult, TEffectHKT> {
    return new SQLiteEffectSelectBuilder({
      fields: fields ?? void 0,
      session: this.session,
      dialect: this.dialect
    });
  }

  selectDistinct(): SQLiteEffectSelectBuilder<undefined, TRunResult, TEffectHKT>;
  selectDistinct<TSelection extends SelectedFields>(
    fields: TSelection
  ): SQLiteEffectSelectBuilder<TSelection, TRunResult, TEffectHKT>;
  selectDistinct(
    fields?: SelectedFields
  ): SQLiteEffectSelectBuilder<SelectedFields | undefined, TRunResult, TEffectHKT> {
    return new SQLiteEffectSelectBuilder({
      fields: fields ?? void 0,
      session: this.session,
      dialect: this.dialect,
      distinct: true
    });
  }

  update<TTable extends SQLiteTable>(
    table: TTable
  ): SQLiteEffectUpdateBuilder<TTable, TRunResult, TEffectHKT> {
    return new SQLiteEffectUpdateBuilder(table, this.session, this.dialect);
  }

  insert<TTable extends SQLiteTable>(
    into: TTable
  ): SQLiteEffectInsertBuilder<TTable, TRunResult, TEffectHKT> {
    return new SQLiteEffectInsertBuilder(into, this.session, this.dialect);
  }

  delete<TTable extends SQLiteTable>(
    from: TTable
  ): SQLiteEffectDeleteBase<TTable, TRunResult, undefined, false, never, TEffectHKT> {
    return new SQLiteEffectDeleteBase(from, this.session, this.dialect);
  }

  private raw<TResult>(
    query: SQLWrapper | string,
    action: 'all' | 'get' | 'run' | 'values',
    execute: (query: SQL) => Effect.Effect<TResult, TEffectHKT['error'], TEffectHKT['context']>
  ): SQLiteEffectRaw<TResult, TEffectHKT> {
    const sequel = typeof query === 'string' ? sql.raw(query) : query.getSQL();
    return new SQLiteEffectRaw(
      () => execute(sequel),
      () => sequel,
      action,
      this.dialect,
      result => result
    );
  }

  run(query: SQLWrapper | string): SQLiteEffectRaw<TRunResult, TEffectHKT> {
    return this.raw(query, 'run', sequel => this.session.run(sequel));
  }

  all<T = unknown>(query: SQLWrapper | string): SQLiteEffectRaw<T[], TEffectHKT> {
    return this.raw(query, 'all', sequel => this.session.all(sequel));
  }

  get<T = unknown>(query: SQLWrapper | string): SQLiteEffectRaw<T | undefined, TEffectHKT> {
    return this.raw(query, 'get', sequel => this.session.get(sequel));
  }

  values<T extends unknown[] = unknown[]>(
    query: SQLWrapper | string
  ): SQLiteEffectRaw<T[], TEffectHKT> {
    return this.raw(query, 'values', sequel => this.session.values(sequel));
  }

  transaction: <A, E, R>(
    transaction: (
      tx: SQLiteEffectTransaction<TEffectHKT, TRunResult, TRelations>
    ) => Effect.Effect<A, E, R>,
    config?: SQLiteTransactionConfig
  ) => Effect.Effect<A, E | SqlError, R> = (tx, config) => this.session.transaction(tx, config);
}
