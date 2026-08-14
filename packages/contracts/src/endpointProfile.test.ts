import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  AuthProfile,
  AuthProfileId,
  AuthProfileMethod,
  EndpointModelDiscovery,
  EndpointProfile,
  EndpointProfileId,
  EndpointProtocol,
} from "./endpointProfile.ts";

const decodeEndpointProfile = Schema.decodeUnknownSync(EndpointProfile);
const decodeAuthProfile = Schema.decodeUnknownSync(AuthProfile);
const decodeEndpointProfileId = Schema.decodeUnknownSync(EndpointProfileId);
const decodeAuthProfileId = Schema.decodeUnknownSync(AuthProfileId);
const decodeEndpointProtocol = Schema.decodeUnknownSync(EndpointProtocol);
const decodeEndpointModelDiscovery = Schema.decodeUnknownSync(EndpointModelDiscovery);
const decodeAuthProfileMethod = Schema.decodeUnknownSync(AuthProfileMethod);

describe("EndpointProfileId / AuthProfileId slug rules", () => {
  const cases = [
    { schemaName: "EndpointProfileId", decode: decodeEndpointProfileId },
    { schemaName: "AuthProfileId", decode: decodeAuthProfileId },
  ] as const;

  for (const { schemaName, decode } of cases) {
    describe(schemaName, () => {
      it.each(["omnirouter_prod", "omnirouter_kevin", "x", "abc123"])("accepts %s", (id) => {
        expect(decode(id)).toBe(id);
      });

      it.each([
        ["empty string", ""],
        ["leading digit", "1bad"],
        ["whitespace inside", "has space"],
      ])("rejects %s", (_label, value) => {
        expect(() => decode(value)).toThrow();
      });
    });
  }
});

describe("EndpointProtocol", () => {
  it.each([
    "openai-responses",
    "openai-chat",
    "anthropic-messages",
    "xai-responses",
    "acp",
    "custom",
  ] as const)("accepts %s", (protocol) => {
    expect(decodeEndpointProtocol(protocol)).toBe(protocol);
  });

  it("rejects a baked omnirouter-only protocol literal", () => {
    expect(() => decodeEndpointProtocol("omnirouter")).toThrow();
  });
});

describe("EndpointModelDiscovery", () => {
  it("accepts models-endpoint, static, and harness variants", () => {
    expect(decodeEndpointModelDiscovery({ type: "models-endpoint" })).toEqual({
      type: "models-endpoint",
    });
    expect(decodeEndpointModelDiscovery({ type: "static", models: ["gpt-4o"] })).toEqual({
      type: "static",
      models: ["gpt-4o"],
    });
    expect(decodeEndpointModelDiscovery({ type: "harness" })).toEqual({ type: "harness" });
  });
});

describe("EndpointProfile", () => {
  it("decodes a minimal profile and defaults modelDiscovery to models-endpoint", () => {
    const decoded = decodeEndpointProfile({
      name: "OmniRouter",
      baseUrl: "https://router.example/v1",
      protocol: "openai-responses",
    });
    expect(decoded).toMatchObject({
      name: "OmniRouter",
      baseUrl: "https://router.example/v1",
      protocol: "openai-responses",
      modelDiscovery: { type: "models-endpoint" },
    });
  });

  it("rejects a baked omnirouter-only protocol literal", () => {
    expect(() =>
      decodeEndpointProfile({
        name: "x",
        baseUrl: "https://example",
        protocol: "omnirouter",
      }),
    ).toThrow();
  });

  it("accepts optional headers, query, and capabilities", () => {
    const decoded = decodeEndpointProfile({
      name: "Custom",
      baseUrl: "https://api.example/v1",
      protocol: "custom",
      headers: { "X-Foo": "bar" },
      query: { region: "us" },
      modelDiscovery: { type: "static", models: ["m1"] },
      capabilities: { streaming: true, tools: false },
    });
    expect(decoded.headers).toEqual({ "X-Foo": "bar" });
    expect(decoded.query).toEqual({ region: "us" });
    expect(decoded.capabilities).toEqual({ streaming: true, tools: false });
  });
});

describe("AuthProfileMethod", () => {
  it.each([
    "none",
    "bearer-env",
    "api-key-env",
    "header-env",
    "token-command",
    "oauth-device",
    "oauth-browser",
  ] as const)("accepts %s", (method) => {
    expect(decodeAuthProfileMethod(method)).toBe(method);
  });
});

describe("AuthProfile", () => {
  it("decodes metadata-only bearer-env profile", () => {
    const decoded = decodeAuthProfile({
      name: "Kevin OmniRouter",
      method: "bearer-env",
      envKey: "OMNIROUTER_TOKEN",
      secretRedacted: true,
    });
    expect(decoded).toEqual({
      name: "Kevin OmniRouter",
      method: "bearer-env",
      envKey: "OMNIROUTER_TOKEN",
      secretRedacted: true,
    });
  });

  it("accepts header-env and token-command optional fields", () => {
    expect(
      decodeAuthProfile({
        name: "Header",
        method: "header-env",
        envKey: "MY_KEY",
        headerName: "X-Api-Key",
      }),
    ).toMatchObject({ headerName: "X-Api-Key", envKey: "MY_KEY" });

    expect(
      decodeAuthProfile({
        name: "Cmd",
        method: "token-command",
        tokenCommand: "op read op://vault/token",
      }),
    ).toMatchObject({ tokenCommand: "op read op://vault/token" });
  });
});
