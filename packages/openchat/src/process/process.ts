import { ChildProcess } from 'effect/unstable/process';
import { Context, Duration, Effect, Fiber, Layer, Stream } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { SchemaProcess } from '@/schema';
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';

const describeCommand = (command: ChildProcess.Command): string => {
  if (command._tag === 'StandardCommand') {
    return command.args.length ? `${command.command} ${command.args.join(' ')}` : command.command;
  }
  return `${describeCommand(command.left)} | ${describeCommand(command.right)}`;
};

const collectStream = (
  stream: Stream.Stream<Uint8Array, PlatformError>,
  maxOutputBytes: number | undefined
) =>
  Stream.runFold(
    stream,
    () => ({ chunks: [] as Uint8Array[], bytes: 0, truncated: false }),
    (acc, chunk) => {
      if (maxOutputBytes === void 0) {
        acc.chunks.push(chunk);
        acc.bytes += chunk.length;
        return acc;
      }
      const remaining = maxOutputBytes - acc.bytes;
      if (remaining > 0) {
        acc.chunks.push(remaining >= chunk.length ? chunk : chunk.slice(0, remaining));
      }
      acc.bytes += chunk.length;
      acc.truncated = acc.truncated || acc.bytes > maxOutputBytes;
      return acc;
    }
  ).pipe(Effect.map(x => ({ buffer: Buffer.concat(x.chunks), truncated: x.truncated })));

const normalizeStdin = (
  input: string | Uint8Array | Stream.Stream<Uint8Array, PlatformError>
): Stream.Stream<Uint8Array, PlatformError> =>
  typeof input === 'string'
    ? Stream.make(new TextEncoder().encode(input))
    : input instanceof Uint8Array
      ? Stream.make(input)
      : input;

const wrapError = (description: string, cause: unknown): SchemaProcess.AppProcessError =>
  cause instanceof SchemaProcess.AppProcessError
    ? cause
    : new SchemaProcess.AppProcessError({ command: description, cause });

const abortError = (signal: AbortSignal): Error => {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
};

const waitForAbort = (signal: AbortSignal) =>
  Effect.callback<never, Error>(resume => {
    if (signal.aborted) {
      resume(Effect.fail(abortError(signal)));
      return;
    }
    const onabort = () => resume(Effect.fail(abortError(signal)));
    signal.addEventListener('abort', onabort, { once: true });
    return Effect.sync(() => signal.removeEventListener('abort', onabort));
  });

export interface RunOptions {
  readonly maxOutputBytes?: number;
  readonly maxErrorBytes?: number;
  readonly signal?: AbortSignal;
  readonly timeout?: Duration.Input;
  readonly stdin?: string | Uint8Array | Stream.Stream<Uint8Array, PlatformError>;
}

export interface RunStreamOptions {
  readonly signal?: AbortSignal;
  readonly includeStderr?: boolean;
  readonly okExitCodes?: ReadonlyArray<number>;
  readonly maxErrorBytes?: number;
}

export interface RunResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export type Interface = ChildProcessSpawner['Service'] & {
  readonly run: (
    command: ChildProcess.Command,
    options?: RunOptions
  ) => Effect.Effect<RunResult, SchemaProcess.AppProcessError>;
  readonly runStream: (
    command: ChildProcess.Command,
    options?: RunStreamOptions
  ) => Stream.Stream<string, SchemaProcess.AppProcessError>;
};

export class Service extends Context.Service<Service, Interface>()('@openchat/AppProcess') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;

    const runCommand = (command: ChildProcess.Command, options?: RunOptions) => {
      const description = describeCommand(command);
      const collect = Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(command);
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              collectStream(handle.stdout, options?.maxOutputBytes),
              collectStream(handle.stderr, options?.maxErrorBytes),
              handle.exitCode
            ],
            { concurrency: 'unbounded' }
          );
          return {
            command: description,
            exitCode,
            stdout: stdout.buffer,
            stderr: stderr.buffer,
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated
          } satisfies RunResult;
        })
      );
      const timed = options?.timeout
        ? Effect.timeoutOrElse(collect, {
            duration: options.timeout,
            orElse: () =>
              Effect.fail(
                new SchemaProcess.AppProcessError({
                  command: description,
                  cause: new Error('Timed out')
                })
              )
          })
        : collect;
      const aborted = options?.signal
        ? timed.pipe(
            Effect.raceFirst(
              waitForAbort(options.signal).pipe(
                Effect.mapError(cause => wrapError(description, cause))
              )
            )
          )
        : timed;
      return aborted.pipe(Effect.catch(cause => Effect.fail(wrapError(description, cause))));
    };

    const run = Effect.fn('AppProcess.run')(function* (
      command: ChildProcess.Command,
      options?: RunOptions
    ) {
      if (options?.stdin === void 0) {
        return yield* runCommand(command, options);
      }
      if (command._tag !== 'StandardCommand') {
        return yield* new SchemaProcess.AppProcessError({
          command: describeCommand(command),
          cause: new Error('stdin option only supports StandardCommand; received PipedCommand')
        });
      }
      const next = ChildProcess.make(command.command, command.args, {
        ...command.options,
        stdin: normalizeStdin(options.stdin)
      });
      return yield* runCommand(next, options);
    });

    const runStream = (
      command: ChildProcess.Command,
      options?: RunStreamOptions
    ): Stream.Stream<string, SchemaProcess.AppProcessError> => {
      const description = describeCommand(command);
      const okExitCodes = options?.okExitCodes;
      const built: Stream.Stream<string, SchemaProcess.AppProcessError | PlatformError> =
        Stream.unwrap(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(command);
            const stderrFiber = yield* Effect.forkScoped(
              collectStream(handle.stderr, options?.maxErrorBytes).pipe(
                Effect.map(x => x.buffer.toString('utf8'))
              )
            );
            const source = options?.includeStderr === true ? handle.all : handle.stdout;
            const lines = source.pipe(
              Stream.decodeText,
              Stream.splitLines,
              Stream.filter(line => line.length > 0)
            );
            const tail = Stream.unwrap(
              Effect.gen(function* () {
                const code = yield* handle.exitCode;
                if (okExitCodes && okExitCodes.length > 0 && !okExitCodes.includes(code)) {
                  const stderr = yield* Fiber.join(stderrFiber);
                  return Stream.fail(
                    new SchemaProcess.AppProcessError({
                      command: description,
                      exitCode: code,
                      stderr
                    })
                  );
                }
                return Stream.empty;
              })
            );
            return Stream.concat(lines, tail);
          })
        );
      const mapped = built.pipe(
        Stream.catch(
          (cause): Stream.Stream<string, SchemaProcess.AppProcessError> =>
            Stream.fail(wrapError(description, cause))
        )
      );
      if (!options?.signal) {
        return mapped;
      }
      const signal = options.signal;
      return mapped.pipe(
        Stream.interruptWhen(
          waitForAbort(signal).pipe(Effect.mapError(cause => wrapError(description, cause)))
        )
      );
    };

    return Service.of({
      ...spawner,
      run,
      runStream
    });
  })
);
