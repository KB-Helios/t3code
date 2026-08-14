import {
  deviceCodePanel,
  preferredSignInMethod,
  providerAuthControlsModel,
  type ProviderAuthControlsModel,
  type ProviderAuthDeviceCodePanel,
} from "@t3tools/client-runtime/state/providerAuth";
import type { ProviderAuthState } from "@t3tools/contracts";

export type { ProviderAuthControlsModel, ProviderAuthDeviceCodePanel };

export function toProviderAuthControlsModel(
  state: ProviderAuthState | undefined,
): ProviderAuthControlsModel {
  return providerAuthControlsModel(state);
}

export function deviceCodeInstructions(
  state: Extract<ProviderAuthState, { state: "pending"; method: "device-code" }>,
): ProviderAuthDeviceCodePanel {
  return deviceCodePanel(state);
}

export function resolveSignInMethod(state: ProviderAuthState | undefined) {
  return state?.state === "unauthenticated" ? preferredSignInMethod(state.methods) : undefined;
}
