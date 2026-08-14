import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { AuthProfileMethod } from "./endpointProfile.ts";
import {
  ProviderAuthError,
  ProviderAuthFlowId,
  ProviderAuthMethod,
  ProviderAuthState,
} from "./providerAuth.ts";
import { WS_METHODS } from "./rpc.ts";

const decodeMethod = Schema.decodeUnknownSync(ProviderAuthMethod);
const decodeState = Schema.decodeUnknownSync(ProviderAuthState);
const decodeFlowId = Schema.decodeUnknownSync(ProviderAuthFlowId);
const encodeState = Schema.encodeUnknownSync(ProviderAuthState);

describe("ProviderAuthMethod", () => {
  it.each(["device-code", "browser", "api-key", "token-command"] as const)(
    "accepts %s",
    (method) => {
      expect(decodeMethod(method)).toBe(method);
    },
  );

  it("is distinct from AuthProfileMethod", () => {
    expect(() => decodeMethod("oauth-device")).toThrow();
    expect(() => decodeMethod("oauth-browser")).toThrow();
    expect(() => decodeMethod("bearer-env")).toThrow();
    expect(() => decodeMethod("api-key-env")).toThrow();
    expect(() => Schema.decodeUnknownSync(AuthProfileMethod)("device-code")).toThrow();
    expect(() => Schema.decodeUnknownSync(AuthProfileMethod)("browser")).toThrow();
  });
});

describe("ProviderAuthFlowId", () => {
  it("accepts a trimmed non-empty id", () => {
    expect(decodeFlowId("flow-1")).toBe("flow-1");
  });

  it("rejects empty ids", () => {
    expect(() => decodeFlowId("")).toThrow();
    expect(() => decodeFlowId("   ")).toThrow();
  });
});

describe("ProviderAuthState", () => {
  it("decodes authenticated with optional account and methods", () => {
    expect(decodeState({ state: "authenticated" })).toEqual({ state: "authenticated" });
    expect(
      decodeState({
        state: "authenticated",
        account: "ada@example.com",
        methods: ["device-code"],
      }),
    ).toEqual({
      state: "authenticated",
      account: "ada@example.com",
      methods: ["device-code"],
    });
  });

  it("decodes unauthenticated with required methods", () => {
    expect(decodeState({ state: "unauthenticated", methods: ["device-code", "browser"] })).toEqual({
      state: "unauthenticated",
      methods: ["device-code", "browser"],
    });
    expect(() => decodeState({ state: "unauthenticated" })).toThrow();
  });

  it("decodes pending device-code", () => {
    expect(
      decodeState({
        state: "pending",
        method: "device-code",
        flowId: "flow-device",
        verificationUri: "https://x.ai/device",
        userCode: "ABCD-EFGH",
        expiresAt: "2026-08-13T12:00:00.000Z",
      }),
    ).toEqual({
      state: "pending",
      method: "device-code",
      flowId: "flow-device",
      verificationUri: "https://x.ai/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-08-13T12:00:00.000Z",
    });
  });

  it("decodes pending browser with a host-local message", () => {
    expect(
      decodeState({
        state: "pending",
        method: "browser",
        flowId: "flow-browser",
        message: "Finish Codex login on the environment host",
      }),
    ).toEqual({
      state: "pending",
      method: "browser",
      flowId: "flow-browser",
      message: "Finish Codex login on the environment host",
    });
  });

  it("decodes error", () => {
    expect(decodeState({ state: "error", message: "Login failed" })).toEqual({
      state: "error",
      message: "Login failed",
    });
  });

  it("rejects a device-code pending payload that omits the user code", () => {
    expect(() =>
      decodeState({
        state: "pending",
        method: "device-code",
        flowId: "flow-device",
        verificationUri: "https://x.ai/device",
        expiresAt: "2026-08-13T12:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("ProviderAuthError", () => {
  it("carries a message", () => {
    const error = new ProviderAuthError({ message: "Unknown provider instance" });
    expect(error._tag).toBe("ProviderAuthError");
    expect(error.message).toContain("Unknown provider instance");
  });
});

describe("providerAuth RPC names", () => {
  it("uses the providerAuth.* method surface", () => {
    expect(WS_METHODS.providerAuthGetStatus).toBe("providerAuth.getStatus");
    expect(WS_METHODS.providerAuthBegin).toBe("providerAuth.begin");
    expect(WS_METHODS.providerAuthGetFlow).toBe("providerAuth.getFlow");
    expect(WS_METHODS.providerAuthCancel).toBe("providerAuth.cancel");
    expect(WS_METHODS.providerAuthLogout).toBe("providerAuth.logout");
  });
});

describe("ProviderAuthState encoding", () => {
  it("round-trips a device-code pending state without extra fields", () => {
    const state = decodeState({
      state: "pending",
      method: "device-code",
      flowId: "flow-device",
      verificationUri: "https://x.ai/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-08-13T12:00:00.000Z",
    });
    expect(encodeState(state)).toEqual({
      state: "pending",
      method: "device-code",
      flowId: "flow-device",
      verificationUri: "https://x.ai/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-08-13T12:00:00.000Z",
    });
  });
});
