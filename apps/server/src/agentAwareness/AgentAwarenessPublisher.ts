import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import type { AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";
import { projectThreadAwareness } from "@t3tools/shared/agentAwareness";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { makeApnsClient } from "./ApnsClient.ts";
import { readApnsConfiguration } from "./ApnsConfiguration.ts";
import type { AgentAwarenessRegistration } from "./AgentAwarenessRegistrations.ts";
import * as AgentAwarenessRegistrations from "./AgentAwarenessRegistrations.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";

export type AgentAwarenessDeliveryPlan =
  | { readonly kind: "notification"; readonly token: string }
  | {
      readonly kind: "live-activity";
      readonly token: string;
      readonly event: "start" | "update" | "end";
    };

const ALERT_PHASES = new Set<AgentAwarenessPhase>([
  "waiting_for_approval",
  "waiting_for_input",
  "completed",
  "failed",
]);

export function planAgentAwarenessDeliveries(input: {
  readonly registration: AgentAwarenessRegistration;
  readonly phase: AgentAwarenessPhase;
  readonly startAlreadySent: boolean;
}): ReadonlyArray<AgentAwarenessDeliveryPlan> {
  const plans: AgentAwarenessDeliveryPlan[] = [];
  const { registration } = input;
  if (
    registration.preferences.notificationsEnabled &&
    registration.deviceToken &&
    ALERT_PHASES.has(input.phase)
  ) {
    plans.push({ kind: "notification", token: registration.deviceToken });
  }
  if (!registration.preferences.liveActivitiesEnabled) {
    return plans;
  }
  if (registration.liveActivityToken) {
    plans.push({
      kind: "live-activity",
      token: registration.liveActivityToken,
      event: input.phase === "completed" || input.phase === "failed" ? "end" : "update",
    });
  } else if (registration.pushToStartToken && !input.startAlreadySent) {
    plans.push({ kind: "live-activity", token: registration.pushToStartToken, event: "start" });
  }
  return plans;
}

function eventThreadId(event: OrchestrationEvent): ThreadId | null {
  const payload = event.payload as { readonly threadId?: unknown };
  if (typeof payload.threadId === "string") return payload.threadId as ThreadId;
  if (event.aggregateKind === "thread") return event.aggregateId as ThreadId;
  return null;
}

function shouldPublish(event: OrchestrationEvent): boolean {
  if (event.type === "thread.message-sent" || event.type === "thread.turn-start-requested") {
    return false;
  }
  if (event.type !== "thread.activity-appended") return true;
  return [
    "approval.requested",
    "approval.resolved",
    "provider.approval.respond.failed",
    "user-input.requested",
    "user-input.resolved",
    "runtime.error",
  ].includes(event.payload.activity.kind);
}

export class AgentAwarenessPublisher extends Context.Service<
  AgentAwarenessPublisher,
  {
    readonly publishThread: (threadId: ThreadId) => Effect.Effect<void>;
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/agentAwareness/AgentAwarenessPublisher") {}

export const make = Effect.gen(function* () {
  const registrations = yield* AgentAwarenessRegistrations.AgentAwarenessRegistrations;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const orchestration = yield* OrchestrationEngine.OrchestrationEngineService;
  const fileSystem = yield* FileSystem.FileSystem;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<FileSystem.FileSystem>());
  const configuration = yield* Effect.promise(() =>
    readApnsConfiguration(process.env, (path) => runPromise(fileSystem.readFileString(path))),
  );
  const apns =
    configuration.capability === "available" ? makeApnsClient(configuration.config) : null;
  const startSent = new Set<string>();

  const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
  const publishThreadUnsafe = Effect.fn("AgentAwarenessPublisher.publishThreadUnsafe")(function* (
    threadId: ThreadId,
  ) {
    if (!apns) return;
    const thread = yield* snapshots.getThreadShellById(threadId);
    if (Option.isNone(thread)) return;
    const project = yield* snapshots.getProjectShellById(thread.value.projectId);
    if (Option.isNone(project)) return;
    const environmentId = yield* environment.getEnvironmentId;
    const state = projectThreadAwareness({
      environmentId,
      project: project.value,
      thread: thread.value,
    });
    if (!state) return;
    const timestamp = Math.floor((yield* DateTime.now).epochMilliseconds / 1_000);
    const active = state.phase !== "completed" && state.phase !== "failed";
    const activityProps = {
      title: "T3 Code",
      subtitle: state.headline,
      activeCount: active ? 1 : 0,
      updatedAt: state.updatedAt,
      activities: [
        {
          environmentId: state.environmentId,
          threadId: state.threadId,
          projectTitle: state.projectTitle,
          threadTitle: state.threadTitle,
          modelTitle: state.modelTitle,
          phase: state.phase,
          status: state.headline,
          updatedAt: state.updatedAt,
          deepLink: state.deepLink,
        },
      ],
    };
    const contentState = {
      name: "AgentActivity" as const,
      props: yield* encodeJson(activityProps),
    };
    yield* Effect.forEach(
      yield* registrations.list,
      (registration) =>
        Effect.forEach(
          planAgentAwarenessDeliveries({
            registration,
            phase: state.phase,
            startAlreadySent: startSent.has(registration.installationId),
          }),
          (delivery) =>
            Effect.tryPromise({
              try: () =>
                delivery.kind === "notification"
                  ? apns.sendNotification({
                      token: delivery.token,
                      title: state.headline,
                      body: `${state.threadTitle} · ${state.projectTitle}`,
                      deepLink: state.deepLink,
                    })
                  : apns.sendLiveActivity({
                      token: delivery.token,
                      event: delivery.event,
                      timestamp,
                      state: contentState,
                    }),
              catch: (cause) =>
                new AgentAwarenessDeliveryError({
                  installationId: registration.installationId,
                  cause,
                }),
            }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  if (delivery.kind === "live-activity" && delivery.event === "start") {
                    startSent.add(registration.installationId);
                  }
                  if (delivery.kind === "live-activity" && delivery.event === "end") {
                    startSent.delete(registration.installationId);
                  }
                }),
              ),
              Effect.catchCause((cause) =>
                Effect.logWarning("APNs agent-awareness delivery failed", {
                  installationId: registration.installationId,
                  cause: Cause.pretty(cause),
                }),
              ),
            ),
          { discard: true },
        ),
      { concurrency: 4, discard: true },
    );
  });

  const publishThread: AgentAwarenessPublisher["Service"]["publishThread"] = (threadId) =>
    publishThreadUnsafe(threadId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Agent-awareness publication failed", {
          threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const start = Effect.gen(function* () {
    if (!apns) {
      yield* Effect.logInfo("iOS push unavailable; APNs operator configuration is incomplete");
      return;
    }
    yield* Stream.runForEach(orchestration.streamDomainEvents, (event) => {
      const threadId = eventThreadId(event);
      return threadId && shouldPublish(event) ? publishThread(threadId) : Effect.void;
    }).pipe(Effect.forkScoped);
  });

  return AgentAwarenessPublisher.of({ publishThread, start });
});

export const layer = Layer.effect(AgentAwarenessPublisher, make);

export class AgentAwarenessDeliveryError extends Schema.TaggedErrorClass<AgentAwarenessDeliveryError>()(
  "AgentAwarenessDeliveryError",
  { installationId: Schema.String, cause: Schema.Defect() },
) {}
