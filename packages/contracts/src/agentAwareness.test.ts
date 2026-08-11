import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { AgentAwarenessRegistrationInput } from "./agentAwareness.ts";

const decodeRegistration = Schema.decodeUnknownSync(AgentAwarenessRegistrationInput);

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
});
