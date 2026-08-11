import { describe, expect, it } from "vite-plus/test";
import * as NodeCrypto from "node:crypto";

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
        async () => testPrivateKey(),
      ),
    ).toEqual({ capability: "unavailable", reason: "apns-not-configured" });
  });

  it("loads a complete development configuration from the private-key path", async () => {
    const readPaths: string[] = [];
    const privateKey = testPrivateKey();
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
          return privateKey;
        },
      ),
    ).toEqual({
      capability: "available",
      config: {
        teamId: "TEAM",
        keyId: "KEY",
        privateKey,
        topic: "com.t3tools.t3code",
        environment: "development",
      },
    });
    expect(readPaths).toEqual(["C:/keys/AuthKey.p8"]);
  });

  it("rejects invalid and non-P-256 private keys as unavailable", async () => {
    const environment = {
      T3CODE_APNS_TEAM_ID: "TEAM",
      T3CODE_APNS_KEY_ID: "KEY",
      T3CODE_APNS_PRIVATE_KEY_PATH: "C:/keys/AuthKey.p8",
      T3CODE_APNS_TOPIC: "com.t3tools.t3code",
      T3CODE_APNS_ENVIRONMENT: "production",
    };
    const rsa = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
      type: "pkcs8",
      format: "pem",
    });

    await expect(readApnsConfiguration(environment, async () => "not-a-key")).resolves.toEqual({
      capability: "unavailable",
      reason: "apns-not-configured",
    });
    await expect(readApnsConfiguration(environment, async () => rsa.toString())).resolves.toEqual({
      capability: "unavailable",
      reason: "apns-not-configured",
    });
  });
});

function testPrivateKey(): string {
  return NodeCrypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
}
