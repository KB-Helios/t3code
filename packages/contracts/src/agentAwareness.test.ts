import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  AgentAwarenessRegistrationInput,
  AgentAwarenessRegistrationResult,
} from "./agentAwareness.ts";

const decodeRegistration = Schema.decodeUnknownSync(AgentAwarenessRegistrationInput);
const decodeResult = Schema.decodeUnknownSync(AgentAwarenessRegistrationResult);

describe("agent awareness contracts", () => {
  it("accepts an installation-scoped registration without a selectable environment id", () => {
    const decoded = decodeRegistration({
      installationId: "installation-1",
      deviceToken: "apns-token",
      pushToStartToken: "activity-start-token",
      preferences: {
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
      },
    });

    expect(decoded).toEqual({
      installationId: "installation-1",
      deviceToken: "apns-token",
      pushToStartToken: "activity-start-token",
      preferences: {
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
      },
    });
    expect("environmentId" in decoded).toBe(false);
  });

  it("rejects an empty installation id", () => {
    expect(() =>
      decodeRegistration({
        installationId: " ",
        preferences: {
          notificationsEnabled: false,
          liveActivitiesEnabled: false,
        },
      }),
    ).toThrow();
  });

  it("requires a reason only for unavailable capability results", () => {
    expect(() => decodeResult({ capability: "unavailable" })).toThrow();
    expect(decodeResult({ capability: "available", reason: "apns-not-configured" })).toEqual({
      capability: "available",
    });
    expect(decodeResult({ capability: "unavailable", reason: "apns-not-configured" })).toEqual({
      capability: "unavailable",
      reason: "apns-not-configured",
    });
  });
});
