import { describe, expect, it } from "vite-plus/test";

import { planAgentAwarenessDeliveries } from "./AgentAwarenessPublisher.ts";

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
        startAlreadySent: false,
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
        startAlreadySent: true,
      }),
    ).toEqual([{ kind: "live-activity", token: "update-token", event: "update" }]);
    expect(
      planAgentAwarenessDeliveries({ registration, phase: "completed", startAlreadySent: true }),
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
      planAgentAwarenessDeliveries({ registration, phase: "running", startAlreadySent: false }),
    ).toEqual([]);
    expect(
      planAgentAwarenessDeliveries({
        registration,
        phase: "waiting_for_approval",
        startAlreadySent: false,
      }),
    ).toEqual([{ kind: "notification", token: "device-token" }]);
  });
});
