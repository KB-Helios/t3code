import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

describe("APNs client", () => {
  it("uses the app topic for device notifications", async () => {
    const module = await import("./ApnsClient.ts").catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const requests: Array<{
      readonly authority: string;
      readonly path: string;
      readonly headers: Record<string, string>;
      readonly payload: unknown;
    }> = [];
    const client = module.makeApnsClient(testConfig(), async (request) => {
      requests.push(request);
      return { status: 200, headers: {}, body: "" };
    });

    await client.sendNotification({
      token: "device-token",
      title: "Approval needed",
      body: "Agent is waiting",
      deepLink: "/threads/thread-1",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      authority: "https://api.sandbox.push.apple.com",
      path: "/3/device/device-token",
      headers: {
        "apns-topic": "com.t3tools.t3code",
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      payload: {
        aps: { alert: { title: "Approval needed", body: "Agent is waiting" } },
        deepLink: "/threads/thread-1",
      },
    });
  });

  it("uses the Live Activity topic and complete start update and end payloads", async () => {
    const module = await import("./ApnsClient.ts");
    const requests: Array<{
      readonly authority: string;
      readonly path: string;
      readonly headers: Record<string, string>;
      readonly payload: unknown;
    }> = [];
    const client = module.makeApnsClient(testConfig(), async (request) => {
      requests.push(request);
      return { status: 200, headers: {}, body: "" };
    });
    const state = { name: "AgentActivity" as const, props: '{"activeCount":1}' };

    await client.sendLiveActivity({ token: "start-token", event: "start", timestamp: 100, state });
    await client.sendLiveActivity({
      token: "update-token",
      event: "update",
      timestamp: 101,
      state,
    });
    await client.sendLiveActivity({ token: "update-token", event: "end", timestamp: 102, state });

    expect(requests.map((request) => request.headers)).toEqual([
      expect.objectContaining({
        "apns-topic": "com.t3tools.t3code.push-type.liveactivity",
        "apns-push-type": "liveactivity",
        "apns-priority": "10",
      }),
      expect.objectContaining({ "apns-priority": "5" }),
      expect.objectContaining({ "apns-priority": "10" }),
    ]);
    expect(requests.map((request) => request.payload)).toEqual([
      {
        aps: {
          timestamp: 100,
          event: "start",
          "attributes-type": "LiveActivityAttributes",
          attributes: {},
          "input-push-token": 1,
          alert: { title: "NorthBridgeCode", body: "Agent work in progress" },
          "content-state": state,
          "stale-date": 700,
        },
      },
      {
        aps: {
          timestamp: 101,
          event: "update",
          "content-state": state,
          "stale-date": 701,
        },
      },
      {
        aps: {
          timestamp: 102,
          event: "end",
          "content-state": state,
          "dismissal-date": 402,
        },
      },
    ]);
  });

  it("returns malformed APNs error bodies without throwing", async () => {
    const module = await import("./ApnsClient.ts");
    const client = module.makeApnsClient(testConfig(), async () => ({
      status: 503,
      headers: {},
      body: "temporarily unavailable",
    }));

    await expect(
      client.sendNotification({ token: "device", title: "Title", body: "Body", deepLink: "/" }),
    ).resolves.toEqual({ ok: false, status: 503, reason: "temporarily unavailable" });
  });

  it("reuses and refreshes an ES256 provider token inside Apple's one-hour limit", async () => {
    const module = await import("./ApnsClient.ts");
    const config = testConfig();
    const requests: Array<{
      readonly authority: string;
      readonly path: string;
      readonly headers: Record<string, string>;
      readonly payload: unknown;
    }> = [];
    let now = 1_000;
    const client = module.makeApnsClient(
      config,
      async (request) => {
        requests.push(request);
        return { status: 200, headers: {}, body: "" };
      },
      () => now,
    );

    await client.sendNotification({ token: "one", title: "One", body: "One", deepLink: "/" });
    now += 2_699;
    await client.sendNotification({ token: "two", title: "Two", body: "Two", deepLink: "/" });
    now += 1;
    await client.sendNotification({ token: "three", title: "Three", body: "Three", deepLink: "/" });

    const first = requests[0]!.headers.authorization!.replace("bearer ", "");
    const second = requests[1]!.headers.authorization!.replace("bearer ", "");
    const third = requests[2]!.headers.authorization!.replace("bearer ", "");
    expect(second).toBe(first);
    expect(third).not.toBe(first);
    const [header, payload, signature] = first.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY123",
    });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({
      iss: "TEAM123",
      iat: 1_000,
    });
    expect(
      NodeCrypto.verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: config.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });
});

function testConfig() {
  const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    teamId: "TEAM123",
    keyId: "KEY123",
    privateKey,
    publicKey,
    topic: "com.t3tools.t3code",
    environment: "development" as const,
  };
}
