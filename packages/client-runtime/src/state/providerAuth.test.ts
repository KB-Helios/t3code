import { describe, expect, it } from "vite-plus/test";
import { ProviderAuthFlowId, type ProviderAuthState } from "@t3tools/contracts";

import {
  deviceCodePanel,
  preferredSignInMethod,
  providerAuthControlsModel,
  serializedProviderAuthContainsSecret,
} from "./providerAuth.ts";

const pendingDevice: ProviderAuthState = {
  state: "pending",
  method: "device-code",
  flowId: ProviderAuthFlowId.make("flow-1"),
  verificationUri: "https://x.ai/device",
  userCode: "ABCD-EFGH",
  expiresAt: "2026-08-13T12:00:00.000Z",
};

describe("providerAuthControlsModel", () => {
  it("exposes a copyable device-code panel for pending Grok login", () => {
    const model = providerAuthControlsModel(pendingDevice);
    expect(model.deviceCode).toEqual(
      deviceCodePanel({
        state: "pending",
        method: "device-code",
        flowId: pendingDevice.flowId,
        verificationUri: "https://x.ai/device",
        userCode: "ABCD-EFGH",
        expiresAt: "2026-08-13T12:00:00.000Z",
      }),
    );
    expect(model.deviceCode?.mobileMessage).toBe("Open https://x.ai/device and enter ABCD-EFGH");
    expect(model.deviceCode?.copyLabel).toBe("ABCD-EFGH");
    expect(model.canCancel).toBe(true);
    expect(model.canSignIn).toBe(false);
  });

  it("shows host-local browser instructions for Codex ChatGPT login", () => {
    const model = providerAuthControlsModel({
      state: "pending",
      method: "browser",
      flowId: ProviderAuthFlowId.make("flow-2"),
      message: "Finish Codex login on the environment host",
    });
    expect(model.browser?.message).toBe("Finish Codex login on the environment host");
    expect(model.deviceCode).toBeUndefined();
    expect(model.canCancel).toBe(true);
  });

  it("offers Sign in for unauthenticated device-code providers", () => {
    const model = providerAuthControlsModel({
      state: "unauthenticated",
      methods: ["device-code"],
    });
    expect(model.canSignIn).toBe(true);
    expect(model.signInMethod).toBe("device-code");
    expect(model.canSignOut).toBe(false);
  });

  it("offers Sign out when authenticated", () => {
    const model = providerAuthControlsModel({
      state: "authenticated",
      account: "ada@example.com",
    });
    expect(model.canSignOut).toBe(true);
    expect(model.account).toBe("ada@example.com");
    expect(model.canSignIn).toBe(false);
  });

  it("does not treat API-key-only methods as an interactive sign-in", () => {
    expect(preferredSignInMethod(["api-key"])).toBeUndefined();
    expect(
      providerAuthControlsModel({ state: "unauthenticated", methods: ["api-key"] }).canSignIn,
    ).toBe(false);
  });

  it("keeps Sign in available after a failed login", () => {
    const model = providerAuthControlsModel({
      state: "error",
      message: "Grok login process failed",
    });
    expect(model.error).toBe("Grok login process failed");
    expect(model.canSignIn).toBe(true);
    expect(model.canSignOut).toBe(false);
  });
});

describe("serializedProviderAuthContainsSecret", () => {
  it("never reports a refresh token from a pending device-code payload", () => {
    expect(serializedProviderAuthContainsSecret(pendingDevice, "xyz")).toBe(false);
    expect(serializedProviderAuthContainsSecret(pendingDevice, "refresh_token")).toBe(false);
  });
});
