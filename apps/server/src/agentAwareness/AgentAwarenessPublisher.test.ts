import type { AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect, vi } from "vite-plus/test";

import {
  deliverAgentAwarenessPlan,
  makeAgentAwarenessAggregate,
  planAgentAwarenessDeliveries,
} from "./AgentAwarenessPublisher.ts";

describe("agent awareness delivery planning", () => {
  it("starts a Live Activity once through the push-to-start token", () => {
    expect(
      planAgentAwarenessDeliveries({
        registration: {
          installationId: "installation-1",
          pushToStartToken: "start-token",
          preferences: { notificationsEnabled: false, liveActivitiesEnabled: true },
          registeredAt: "2026-08-11T00:00:00.000Z",
        },
        phase: "running",
        aggregateActiveCount: 1,
        notificationAlreadySent: false,
      }),
    ).toEqual([{ kind: "live-activity", token: "start-token", event: "start" }]);
  });

  it("updates and ends through the ActivityKit update token", () => {
    const registration = {
      installationId: "installation-1",
      liveActivityToken: "update-token",
      preferences: { notificationsEnabled: false, liveActivitiesEnabled: true },
      registeredAt: "2026-08-11T00:00:00.000Z",
    };
    expect(
      planAgentAwarenessDeliveries({
        registration,
        phase: "waiting_for_input",
        aggregateActiveCount: 1,
        notificationAlreadySent: false,
      }),
    ).toEqual([{ kind: "live-activity", token: "update-token", event: "update" }]);
    expect(
      planAgentAwarenessDeliveries({
        registration,
        phase: "completed",
        aggregateActiveCount: 0,
        notificationAlreadySent: false,
      }),
    ).toEqual([{ kind: "live-activity", token: "update-token", event: "end" }]);
  });

  it("alerts only phases that require attention or report a terminal result", () => {
    const registration = {
      installationId: "installation-1",
      deviceToken: "device-token",
      preferences: { notificationsEnabled: true, liveActivitiesEnabled: false },
      registeredAt: "2026-08-11T00:00:00.000Z",
    };
    expect(
      planAgentAwarenessDeliveries({
        registration,
        phase: "running",
        aggregateActiveCount: 1,
        notificationAlreadySent: false,
      }),
    ).toEqual([]);
    expect(
      planAgentAwarenessDeliveries({
        registration,
        phase: "waiting_for_approval",
        aggregateActiveCount: 1,
        notificationAlreadySent: false,
      }),
    ).toEqual([{ kind: "notification", token: "device-token" }]);
    expect(
      planAgentAwarenessDeliveries({
        registration,
        phase: "waiting_for_approval",
        aggregateActiveCount: 1,
        notificationAlreadySent: true,
      }),
    ).toEqual([]);
  });

  it("does not resend a durable push-to-start generation", () => {
    expect(
      planAgentAwarenessDeliveries({
        registration: {
          installationId: "installation-1",
          pushToStartToken: "start-token",
          startedPushToStartToken: "start-token",
          preferences: { notificationsEnabled: false, liveActivitiesEnabled: true },
          registeredAt: "2026-08-11T00:00:00.000Z",
        },
        phase: "running",
        aggregateActiveCount: 1,
        notificationAlreadySent: false,
      }),
    ).toEqual([]);
  });

  it("keeps other active threads when the triggering thread finishes", () => {
    const aggregate = makeAgentAwarenessAggregate({
      states: [
        state("thread-running", "running", "Working", "Project"),
        state("thread-done", "completed", "Done", "Project"),
        state("thread-input", "waiting_for_input", "Input", "Project"),
        state("thread-approval", "waiting_for_approval", "Approval", "Project"),
        state("thread-4", "running", "Four", "Project"),
        state("thread-5", "running", "Five", "Project"),
        state("thread-6", "running", "Six", "Project"),
      ],
      triggeringThreadId: "thread-done" as never,
    });

    expect(aggregate?.activeCount).toBe(6);
    expect(aggregate?.activities).toHaveLength(5);
    expect(aggregate?.activities.map((row) => row.threadId).slice(0, 2)).toEqual([
      "thread-approval",
      "thread-input",
    ]);
    expect(aggregate?.activities.some((row) => row.threadId === "thread-done")).toBe(true);
  });

  it("sanitizes aggregate text and rejects non-relative deep links", () => {
    const aggregate = makeAgentAwarenessAggregate({
      states: [
        {
          ...state("thread-1", "running", "x".repeat(200), "p".repeat(200)),
          deepLink: "https://example.com/secret",
          modelTitle: "m".repeat(200),
        },
      ],
      triggeringThreadId: "thread-1" as never,
    });
    const row = aggregate!.activities[0]!;
    expect(row.projectTitle.length).toBeLessThanOrEqual(120);
    expect(row.threadTitle.length).toBeLessThanOrEqual(120);
    expect(row.modelTitle.length).toBeLessThanOrEqual(120);
    expect(row.status.length).toBeLessThanOrEqual(40);
    expect(row.deepLink).toBe("/");
  });

  it.effect("does not mutate delivery state after an APNs rejection", () =>
    Effect.gen(function* () {
      const onSuccess = vi.fn();
      const error = yield* Effect.flip(
        deliverAgentAwarenessPlan({
          send: Effect.succeed({ ok: false, status: 400, reason: "BadDeviceToken" }),
          onSuccess: Effect.sync(onSuccess),
        }),
      );
      expect(error.message).toContain("BadDeviceToken");
      expect(onSuccess).not.toHaveBeenCalled();
    }),
  );
});

function state(
  threadId: string,
  phase: AgentAwarenessState["phase"],
  threadTitle: string,
  projectTitle: string,
): AgentAwarenessState {
  return {
    environmentId: "environment-1" as never,
    threadId: threadId as never,
    projectTitle,
    threadTitle,
    phase,
    headline: `${phase} status`,
    modelTitle: "gpt-5",
    updatedAt: "2026-08-11T00:00:00.000Z",
    deepLink: `/threads/environment-1/${threadId}`,
  };
}
