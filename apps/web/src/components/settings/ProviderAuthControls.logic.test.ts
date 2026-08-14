import { describe, expect, it } from "vite-plus/test";
import { ProviderAuthFlowId, type ProviderAuthState } from "@t3tools/contracts";

import {
  deviceCodeInstructions,
  resolveSignInMethod,
  toProviderAuthControlsModel,
} from "./ProviderAuthControls.logic";

const pendingDevice: ProviderAuthState = {
  state: "pending",
  method: "device-code",
  flowId: ProviderAuthFlowId.make("flow-web"),
  verificationUri: "https://x.ai/device",
  userCode: "ABCD-EFGH",
  expiresAt: "2026-08-13T12:00:00.000Z",
};

describe("ProviderAuthControls.logic", () => {
  it("renders device-code URI as a link target and the user code as copyable text", () => {
    const panel = deviceCodeInstructions(pendingDevice);
    expect(panel.verificationUri).toBe("https://x.ai/device");
    expect(panel.openLabel).toBe("Open https://x.ai/device");
    expect(panel.copyLabel).toBe("ABCD-EFGH");
    expect(panel.userCode).toBe("ABCD-EFGH");
    expect(panel.mobileMessage).toBe("Open https://x.ai/device and enter ABCD-EFGH");
  });

  it("does not leak a refresh token through the device-code panel", () => {
    expect(JSON.stringify(deviceCodeInstructions(pendingDevice))).not.toContain("refresh_token");
    expect(JSON.stringify(toProviderAuthControlsModel(pendingDevice))).not.toContain("xyz");
  });

  it("prefers device-code sign-in when the provider advertises it", () => {
    expect(
      resolveSignInMethod({
        state: "unauthenticated",
        methods: ["api-key", "device-code"],
      }),
    ).toBe("device-code");
  });
});
