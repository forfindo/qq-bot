import { Schema } from 'effect';
import { NonNegativeInt } from '@/schema/common';

const PathText = Schema.Struct({
  text: Schema.String
});

const TimeStats = Schema.Struct({
  secs: NonNegativeInt,
  nanos: NonNegativeInt,
  human: Schema.String
});

const Stats = Schema.Struct({
  elapsed: TimeStats,
  searches: NonNegativeInt,
  searches_with_match: NonNegativeInt,
  bytes_searched: NonNegativeInt,
  bytes_printed: NonNegativeInt,
  matched_lines: NonNegativeInt,
  matches: NonNegativeInt
});

export const SearchMatch = Schema.Struct({
  path: PathText,
  lines: Schema.Struct({
    text: Schema.String
  }),
  line_number: NonNegativeInt,
  absolute_offset: NonNegativeInt,
  submatches: Schema.Array(
    Schema.Struct({
      match: Schema.Struct({
        text: Schema.String
      }),
      start: NonNegativeInt,
      end: NonNegativeInt
    })
  )
});

export const Match = Schema.Struct({
  type: Schema.Literal('match'),
  data: SearchMatch
});
export type Match = Schema.Schema.Type<typeof Match>;
export type Item = Match['data'];
export type Row = Match['data'];

const Begin = Schema.Struct({
  type: Schema.Literal('begin'),
  data: Schema.Struct({
    path: PathText
  })
});

const End = Schema.Struct({
  type: Schema.Literal('end'),
  data: Schema.Struct({
    path: PathText,
    binary_offset: Schema.NullOr(NonNegativeInt),
    stats: Stats
  })
});

const Summary = Schema.Struct({
  type: Schema.Literal('summary'),
  data: Schema.Struct({
    elapsed_total: TimeStats,
    stats: Stats
  })
});

export const Result = Schema.Union([Begin, Match, End, Summary]);
export const decodeResult = Schema.decodeUnknownEffect(Schema.fromJsonString(Result));

export interface FilesInput {
  cwd: string;
  glob?: string[];
  hidden?: boolean;
  follow?: boolean;
  maxDepth?: number;
  signal?: AbortSignal;
}

export interface SearchInput {
  cwd: string;
  pattern: string;
  glob?: string[];
  limit?: number;
  follow?: boolean;
  file?: string[];
  signal?: AbortSignal;
}

export interface TreeInput {
  cwd: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface SearchResult {
  items: Item[];
  partial: boolean;
}
