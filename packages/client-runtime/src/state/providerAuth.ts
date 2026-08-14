import {
  type EnvironmentId,
  type ProviderAuthMethod,
  type ProviderAuthState,
  type ProviderInstanceId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export function createProviderAuthEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  const getStatus = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:provider-auth:status",
    tag: WS_METHODS.providerAuthGetStatus,
    staleTimeMs: 2_000,
    refreshIntervalMs: 3_000,
  });
  const getFlow = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:provider-auth:flow",
    tag: WS_METHODS.providerAuthGetFlow,
    staleTimeMs: 1_000,
    refreshIntervalMs: 2_000,
  });
  const refreshInstanceStatus = (
    target: {
      readonly environmentId: EnvironmentId;
      readonly input: { readonly instanceId: ProviderInstanceId };
    },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => {
      registry.refresh(
        getStatus({
          environmentId: target.environmentId,
          input: { instanceId: target.input.instanceId },
        }),
      );
    });
  return {
    getStatus,
    getFlow,
    begin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider-auth:begin",
      tag: WS_METHODS.providerAuthBegin,
      scheduler: commandScheduler,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => `${environmentId}:${input.instanceId}`,
      },
      onSettled: refreshInstanceStatus,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider-auth:cancel",
      tag: WS_METHODS.providerAuthCancel,
      scheduler: commandScheduler,
    }),
    logout: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider-auth:logout",
      tag: WS_METHODS.providerAuthLogout,
      scheduler: commandScheduler,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => `${environmentId}:${input.instanceId}`,
      },
      onSettled: refreshInstanceStatus,
    }),
  };
}

export interface ProviderAuthDeviceCodePanel {
  readonly kind: "device-code";
  readonly verificationUri: string;
  readonly userCode: string;
  readonly expiresAt: string;
  readonly copyLabel: string;
  readonly openLabel: string;
  readonly mobileMessage: string;
}

export interface ProviderAuthBrowserPanel {
  readonly kind: "browser";
  readonly message: string;
}

export interface ProviderAuthControlsModel {
  readonly canSignIn: boolean;
  readonly canSignOut: boolean;
  readonly canCancel: boolean;
  readonly signInMethod: ProviderAuthMethod | undefined;
  readonly account: string | undefined;
  readonly error: string | undefined;
  readonly deviceCode: ProviderAuthDeviceCodePanel | undefined;
  readonly browser: ProviderAuthBrowserPanel | undefined;
}

export function preferredSignInMethod(
  methods: ReadonlyArray<ProviderAuthMethod> | undefined,
): ProviderAuthMethod | undefined {
  if (methods === undefined || methods.length === 0) return undefined;
  if (methods.includes("device-code")) return "device-code";
  if (methods.includes("browser")) return "browser";
  return undefined;
}

export function deviceCodePanel(
  state: Extract<ProviderAuthState, { state: "pending"; method: "device-code" }>,
): ProviderAuthDeviceCodePanel {
  return {
    kind: "device-code",
    verificationUri: state.verificationUri,
    userCode: state.userCode,
    expiresAt: state.expiresAt,
    copyLabel: state.userCode,
    openLabel: `Open ${state.verificationUri}`,
    mobileMessage: `Open ${state.verificationUri} and enter ${state.userCode}`,
  };
}

export function providerAuthControlsModel(
  state: ProviderAuthState | undefined,
): ProviderAuthControlsModel {
  if (state === undefined) {
    return {
      canSignIn: false,
      canSignOut: false,
      canCancel: false,
      signInMethod: undefined,
      account: undefined,
      error: undefined,
      deviceCode: undefined,
      browser: undefined,
    };
  }
  if (state.state === "pending" && state.method === "device-code") {
    return {
      canSignIn: false,
      canSignOut: false,
      canCancel: true,
      signInMethod: undefined,
      account: undefined,
      error: undefined,
      deviceCode: deviceCodePanel(state),
      browser: undefined,
    };
  }
  if (state.state === "pending" && state.method === "browser") {
    return {
      canSignIn: false,
      canSignOut: false,
      canCancel: true,
      signInMethod: undefined,
      account: undefined,
      error: undefined,
      deviceCode: undefined,
      browser: { kind: "browser", message: state.message },
    };
  }
  if (state.state === "authenticated") {
    return {
      canSignIn: false,
      canSignOut: state.methods?.includes("api-key") === true,
      canCancel: false,
      signInMethod: undefined,
      account: state.account,
      error: undefined,
      deviceCode: undefined,
      browser: undefined,
    };
  }
  if (state.state === "error") {
    return {
      canSignIn: true,
      canSignOut: false,
      canCancel: false,
      signInMethod: undefined,
      account: undefined,
      error: state.message,
      deviceCode: undefined,
      browser: undefined,
    };
  }
  return {
    canSignIn: preferredSignInMethod(state.methods) !== undefined,
    canSignOut: false,
    canCancel: false,
    signInMethod: preferredSignInMethod(state.methods),
    account: undefined,
    error: undefined,
    deviceCode: undefined,
    browser: undefined,
  };
}

export function serializedProviderAuthContainsSecret(payload: unknown, secret: string): boolean {
  return JSON.stringify(payload).includes(secret);
}
