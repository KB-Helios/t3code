import { describe, expect, it } from "vite-plus/test";

import { readApnsConfiguration } from "./ApnsConfiguration.ts";

describe("APNs configuration", () => {
  it("is unavailable when any operator-owned value is missing", async () => {
    expect(
      await readApnsConfiguration(
        {
          T3CODE_APNS_TEAM_ID: "TEAM",
          T3CODE_APNS_KEY_ID: "KEY",
          T3CODE_APNS_PRIVATE_KEY_PATH: "C:/keys/AuthKey.p8",
          T3CODE_APNS_TOPIC: "com.t3tools.t3code",
        },
        async () => "private-key",
      ),
    ).toEqual({ capability: "unavailable", reason: "apns-not-configured" });
  });

  it("loads a complete development configuration from the private-key path", async () => {
    const readPaths: string[] = [];
    expect(
      await readApnsConfiguration(
        {
          T3CODE_APNS_TEAM_ID: " TEAM ",
          T3CODE_APNS_KEY_ID: " KEY ",
          T3CODE_APNS_PRIVATE_KEY_PATH: " C:/keys/AuthKey.p8 ",
          T3CODE_APNS_TOPIC: " com.t3tools.t3code ",
          T3CODE_APNS_ENVIRONMENT: "development",
        },
        async (path) => {
          readPaths.push(path);
          return "private-key";
        },
      ),
    ).toEqual({
      capability: "available",
      config: {
        teamId: "TEAM",
        keyId: "KEY",
        privateKey: "private-key",
        topic: "com.t3tools.t3code",
        environment: "development",
      },
    });
    expect(readPaths).toEqual(["C:/keys/AuthKey.p8"]);
  });
});
