// import { Context, Effect, Layer, PubSub, Schema, Scope, Stream } from 'effect';
// import { type Definition, define } from './bus-event'
// import { Identifier } from "@/id"
// import { Log } from '@/utils';
// import { ModuleState } from '@/instance';
//
// type BusProperties<D extends Definition<string, Schema.Top>> = Schema.Schema.Type<D["properties"]>
//
// type Payload<D extends Definition = Definition> = {
//   id: string
//   type: D["type"]
//   properties: BusProperties<D>
// }
//
// type State = {
//   wildcard: PubSub.PubSub<Payload>
//   typed: Map<string, PubSub.PubSub<Payload>>
// }
//
// const log = Log.create({ service: "bus" })
//
// export const InstanceDisposed = define(
//   "server.instance.disposed",
//   Schema.Struct({
//     directory: Schema.String,
//   }),
// )
//
// export interface Interface {
//   readonly publish: <D extends Definition>(
//     def: D,
//     properties: BusProperties<D>,
//     options?: { id?: string },
//   ) => Effect.Effect<void>
//   readonly subscribe: <D extends Definition>(def: D) => Stream.Stream<Payload<D>>
//   readonly subscribeAll: () => Stream.Stream<Payload>
//   readonly subscribeCallback: <D extends Definition>(
//     def: D,
//     callback: (event: Payload<D>) => unknown,
//   ) => Effect.Effect<() => void>
//   readonly subscribeAllCallback: (callback: (event: unknown) => unknown) => Effect.Effect<() => void>
// }
//
// export class Service extends Context.Service<Service, Interface>()("@openchat/Bus") {}
//
// export const layer = Layer.effect(
//   Service,
//   Effect.gen(function* () {
//     const state = yield* ModuleState.make<State>(
//       Effect.fn("Bus.state")(function* (ctx) {
//         const wildcard = yield* PubSub.unbounded<Payload>()
//         const typed = new Map<string, PubSub.PubSub<Payload>>()
//
//         yield* Effect.addFinalizer(() =>
//           Effect.gen(function* () {
//             // Publish InstanceDisposed before shutting down so subscribers see it
//             yield* PubSub.publish(wildcard, {
//               type: InstanceDisposed.type,
//               id: createID(),
//               properties: { directory: ctx.directory },
//             })
//             yield* PubSub.shutdown(wildcard)
//             for (const ps of typed.values()) {
//               yield* PubSub.shutdown(ps)
//             }
//           }),
//         )
//
//         return { wildcard, typed }
//       }),
//     )
//
//     function getOrCreate<D extends Definition>(state: State, def: D) {
//       return Effect.gen(function* () {
//         let ps = state.typed.get(def.type)
//         if (!ps) {
//           ps = yield* PubSub.unbounded<Payload>()
//           state.typed.set(def.type, ps)
//         }
//         return ps as unknown as PubSub.PubSub<Payload<D>>
//       })
//     }
//
//     function publish<D extends Definition>(def: D, properties: BusProperties<D>, options?: { id?: string }) {
//       return Effect.gen(function* () {
//         const s = yield* ModuleState.get(state)
//         const payload: Payload = { id: options?.id ?? createID(), type: def.type, properties }
//         log.info("publishing", { type: def.type })
//
//         const ps = s.typed.get(def.type)
//         if (ps) yield* PubSub.publish(ps, payload)
//         yield* PubSub.publish(s.wildcard, payload)
//
//         const dir = yield* ModuleState.directory
//         const context = yield* ModuleState.context
//         const workspace = yield* ModuleState.workspaceID
//
//         GlobalBus.emit("event", {
//           directory: dir,
//           project: context.project.id,
//           workspace,
//           payload,
//         })
//       })
//     }
//
//     function subscribe<D extends Definition>(def: D): Stream.Stream<Payload<D>> {
//       log.info("subscribing", { type: def.type })
//       return Stream.unwrap(
//         Effect.gen(function* () {
//           const s = yield* ModuleState.get(state)
//           const ps = yield* getOrCreate(s, def)
//           return Stream.fromPubSub(ps)
//         }),
//       ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: def.type }))))
//     }
//
//     function subscribeAll(): Stream.Stream<Payload> {
//       log.info("subscribing", { type: "*" })
//       return Stream.unwrap(
//         Effect.gen(function* () {
//           const s = yield* ModuleState.get(state)
//           return Stream.fromPubSub(s.wildcard)
//         }),
//       ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: "*" }))))
//     }
//
//     function on<T>(pubsub: PubSub.PubSub<T>, type: string, callback: (event: T) => unknown) {
//       return Effect.gen(function* () {
//         log.info("subscribing", { type })
//         const bridge = yield* EffectBridge.make()
//         const scope = yield* Scope.make()
//         const subscription = yield* Scope.provide(scope)(PubSub.subscribe(pubsub))
//
//         yield* Scope.provide(scope)(
//           Stream.fromSubscription(subscription).pipe(
//             Stream.runForEach((msg) =>
//               Effect.tryPromise({
//                 try: () => Promise.resolve().then(() => callback(msg)),
//                 catch: (cause) => {
//                   log.error("subscriber failed", { type, cause })
//                 },
//               }).pipe(Effect.ignore),
//             ),
//             Effect.forkScoped,
//           ),
//         )
//
//         return () => {
//           log.info("unsubscribing", { type })
//           bridge.fork(Scope.close(scope, Exit.void))
//         }
//       })
//     }
//
//     const subscribeCallback = Effect.fn("Bus.subscribeCallback")(function* <D extends Definition>(
//       def: D,
//       callback: (event: Payload<D>) => unknown,
//     ) {
//       const s = yield* ModuleState.get(state)
//       const ps = yield* getOrCreate(s, def)
//       return yield* on(ps, def.type, callback)
//     })
//
//     const subscribeAllCallback = Effect.fn("Bus.subscribeAllCallback")(function* (callback: (event: any) => unknown) {
//       const s = yield* ModuleState.get(state)
//       return yield* on(s.wildcard, "*", callback)
//     })
//
//     return Service.of({ publish, subscribe, subscribeAll, subscribeCallback, subscribeAllCallback })
//   }),
// )
//
// export const defaultLayer = layer
//
// // runSync is safe here because the subscribe chain (ModuleState.get, PubSub.subscribe,
// // Scope.make, Effect.forkScoped) is entirely synchronous. If any step becomes async, this will throw.
// export function createID() {
//   return Identifier.create("evt", "ascending")
// }
