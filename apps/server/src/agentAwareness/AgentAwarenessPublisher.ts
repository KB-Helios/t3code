import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import type { AgentAwarenessPhase, AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import { projectThreadAwareness } from "@t3tools/shared/agentAwareness";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { ApnsDeliveryResult } from "./ApnsClient.ts";
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

export interface AgentAwarenessAggregateRow {
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly modelTitle: string;
  readonly phase: AgentAwarenessPhase;
  readonly status: string;
  readonly updatedAt: string;
  readonly deepLink: string;
}

export interface AgentAwarenessAggregate {
  readonly title: string;
  readonly subtitle: string;
  readonly activeCount: number;
  readonly updatedAt: string;
  readonly activities: ReadonlyArray<AgentAwarenessAggregateRow>;
}

const ALERT_PHASES = new Set<AgentAwarenessPhase>([
  "waiting_for_approval",
  "waiting_for_input",
  "completed",
  "failed",
]);
const MAX_ACTIVITY_ROWS = 5;
const MAX_SUMMARY_TEXT_LENGTH = 120;
const MAX_STATUS_TEXT_LENGTH = 40;
const MAX_DEEP_LINK_LENGTH = 512;

function isTerminalPhase(phase: AgentAwarenessPhase): boolean {
  return phase === "completed" || phase === "failed";
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function sanitizeDeepLink(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//")
    ? truncateText(trimmed, MAX_DEEP_LINK_LENGTH)
    : "/";
}

function statusForPhase(phase: AgentAwarenessPhase): string {
  switch (phase) {
    case "waiting_for_approval":
      return "Approval";
    case "waiting_for_input":
      return "Input";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "starting":
      return "Connecting";
    case "running":
      return "Working";
    case "stale":
      return "Waiting";
  }
}

function phasePriority(phase: AgentAwarenessPhase): number {
  switch (phase) {
    case "waiting_for_approval":
      return 0;
    case "waiting_for_input":
      return 1;
    case "failed":
      return 2;
    case "starting":
    case "running":
      return 3;
    case "completed":
    case "stale":
      return 4;
  }
}

function aggregateRow(state: AgentAwarenessState): AgentAwarenessAggregateRow {
  return {
    environmentId: state.environmentId,
    threadId: state.threadId,
    projectTitle: truncateText(state.projectTitle, MAX_SUMMARY_TEXT_LENGTH),
    threadTitle: truncateText(state.threadTitle, MAX_SUMMARY_TEXT_LENGTH),
    modelTitle: truncateText(state.modelTitle, MAX_SUMMARY_TEXT_LENGTH),
    phase: state.phase,
    status: truncateText(statusForPhase(state.phase), MAX_STATUS_TEXT_LENGTH),
    updatedAt: state.updatedAt,
    deepLink: sanitizeDeepLink(state.deepLink),
  };
}

export function makeAgentAwarenessAggregate(input: {
  readonly states: ReadonlyArray<AgentAwarenessState>;
  readonly triggeringThreadId: ThreadId;
}): AgentAwarenessAggregate | null {
  const triggeringState = input.states.find((state) => state.threadId === input.triggeringThreadId);
  const activeStates = input.states
    .filter((state) => !isTerminalPhase(state.phase))
    .sort(
      (left, right) =>
        phasePriority(left.phase) - phasePriority(right.phase) ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
  const terminalState =
    triggeringState && isTerminalPhase(triggeringState.phase) ? triggeringState : null;
  if (activeStates.length === 0 && terminalState === null) return null;

  const displayedStates = terminalState
    ? [...activeStates.slice(0, MAX_ACTIVITY_ROWS - 1), terminalState]
    : activeStates.slice(0, MAX_ACTIVITY_ROWS);
  const updatedAt = displayedStates.reduce(
    (latest, state) => (state.updatedAt.localeCompare(latest) > 0 ? state.updatedAt : latest),
    displayedStates[0]!.updatedAt,
  );
  const subtitle =
    activeStates.length > 0
      ? "Agent work in progress"
      : terminalState?.phase === "failed"
        ? "Agent work failed"
        : "Agent work completed";
  return {
    title: truncateText("T3 Code", MAX_SUMMARY_TEXT_LENGTH),
    subtitle: truncateText(subtitle, MAX_SUMMARY_TEXT_LENGTH),
    activeCount: activeStates.length,
    updatedAt,
    activities: displayedStates.map(aggregateRow),
  };
}

export function planAgentAwarenessDeliveries(input: {
  readonly registration: AgentAwarenessRegistration;
  readonly phase: AgentAwarenessPhase | null;
  readonly aggregateActiveCount: number;
  readonly notificationAlreadySent: boolean;
}): ReadonlyArray<AgentAwarenessDeliveryPlan> {
  const plans: AgentAwarenessDeliveryPlan[] = [];
  const { registration } = input;
  if (
    input.phase !== null &&
    !input.notificationAlreadySent &&
    registration.preferences.notificationsEnabled &&
    registration.deviceToken &&
    ALERT_PHASES.has(input.phase)
  ) {
    plans.push({ kind: "notification", token: registration.deviceToken });
  }
  if (!registration.preferences.liveActivitiesEnabled) return plans;
  if (registration.liveActivityToken) {
    plans.push({
      kind: "live-activity",
      token: registration.liveActivityToken,
      event: input.aggregateActiveCount === 0 ? "end" : "update",
    });
  } else if (
    input.aggregateActiveCount > 0 &&
    registration.pushToStartToken &&
    registration.startedPushToStartToken !== registration.pushToStartToken
  ) {
    plans.push({ kind: "live-activity", token: registration.pushToStartToken, event: "start" });
  }
  return plans;
}

export class ApnsDeliveryRejectedError extends Schema.TaggedErrorClass<ApnsDeliveryRejectedError>()(
  "ApnsDeliveryRejectedError",
  { status: Schema.Number, reason: Schema.NullOr(Schema.String) },
) {
  override get message(): string {
    return `APNs delivery failed with status ${this.status}${this.reason ? `: ${this.reason}` : ""}`;
  }
}

export function deliverAgentAwarenessPlan<E, R, E2, R2>(input: {
  readonly send: Effect.Effect<ApnsDeliveryResult, E, R>;
  readonly onSuccess: Effect.Effect<void, E2, R2>;
}): Effect.Effect<void, E | E2 | ApnsDeliveryRejectedError, R | R2> {
  return input.send.pipe(
    Effect.flatMap(
      (result): Effect.Effect<void, E2 | ApnsDeliveryRejectedError, R2> =>
        result.ok
          ? input.onSuccess
          : Effect.fail(
              new ApnsDeliveryRejectedError({
                status: result.status,
                reason: result.reason ?? null,
              }),
            ),
    ),
  );
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
  const notifiedPhaseByInstallationThread = new Map<string, AgentAwarenessPhase>();
  const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

  const publishThreadUnsafe = Effect.fn("AgentAwarenessPublisher.publishThreadUnsafe")(function* (
    threadId: ThreadId,
  ) {
    if (!apns) return;
    const environmentId = yield* environment.getEnvironmentId;
    const snapshot = yield* snapshots.getShellSnapshot();
    const projectsById = new Map(snapshot.projects.map((project) => [project.id, project]));
    const states = snapshot.threads.flatMap((thread) => {
      const project = projectsById.get(thread.projectId);
      if (!project) return [];
      const state = projectThreadAwareness({ environmentId, project, thread });
      return state ? [state] : [];
    });
    const triggeringState = states.find((state) => state.threadId === threadId) ?? null;
    const triggeringRow = triggeringState ? aggregateRow(triggeringState) : null;
    const aggregate = makeAgentAwarenessAggregate({ states, triggeringThreadId: threadId });
    if (!aggregate) return;
    const timestamp = Math.floor((yield* DateTime.now).epochMilliseconds / 1_000);
    const contentState = {
      name: "AgentActivity" as const,
      props: yield* encodeJson(aggregate),
    };

    yield* Effect.forEach(
      yield* registrations.list,
      (registration) => {
        const notificationKey = `${registration.installationId}\u0000${threadId}`;
        const phase = triggeringState?.phase ?? null;
        if (phase === null || !ALERT_PHASES.has(phase)) {
          notifiedPhaseByInstallationThread.delete(notificationKey);
        }
        return Effect.forEach(
          planAgentAwarenessDeliveries({
            registration,
            phase,
            aggregateActiveCount: aggregate.activeCount,
            notificationAlreadySent:
              phase !== null && notifiedPhaseByInstallationThread.get(notificationKey) === phase,
          }),
          (delivery) => {
            const send = Effect.tryPromise({
              try: () =>
                delivery.kind === "notification"
                  ? apns.sendNotification({
                      token: delivery.token,
                      title: truncateText(
                        triggeringState?.headline ?? aggregate.subtitle,
                        MAX_SUMMARY_TEXT_LENGTH,
                      ),
                      body: triggeringRow
                        ? truncateText(
                            `${triggeringRow.threadTitle} - ${triggeringRow.projectTitle}`,
                            MAX_SUMMARY_TEXT_LENGTH,
                          )
                        : aggregate.subtitle,
                      deepLink: triggeringRow?.deepLink ?? "/",
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
            });
            const onSuccess =
              delivery.kind === "notification"
                ? Effect.sync(() => {
                    if (phase !== null) {
                      notifiedPhaseByInstallationThread.set(notificationKey, phase);
                    }
                  })
                : delivery.event === "start"
                  ? registrations.markLiveActivityStarted(
                      registration.installationId,
                      delivery.token,
                    )
                  : delivery.event === "end"
                    ? registrations.clearLiveActivityStarted(registration.installationId)
                    : Effect.void;
            return deliverAgentAwarenessPlan({ send, onSuccess }).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("APNs agent-awareness delivery failed", {
                  installationId: registration.installationId,
                  cause: Cause.pretty(cause),
                }),
              ),
            );
          },
          { discard: true },
        );
      },
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
