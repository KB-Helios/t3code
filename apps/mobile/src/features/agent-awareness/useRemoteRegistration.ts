import { useAtomValue } from "@effect/atom-react";
import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import {
  type AgentAwarenessRegistrationInput,
  type AgentAwarenessRegistrationResult,
  type AgentAwarenessUnregistrationInput,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Notifications from "expo-notifications";
import { addPushToStartTokenListener } from "expo-widgets";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { connectionAtomRuntime } from "../../connection/runtime";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { loadOrCreateAgentAwarenessDeviceId } from "../../persistence/imperative";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import AgentActivity from "../../widgets/AgentActivity";
import { supportsAgentAwarenessPush } from "./capabilities";
import { createAgentAwarenessRegistrationManager } from "./remoteRegistration";

const registerCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "agent-awareness:register",
  execute: (request: { environmentId: EnvironmentId; input: AgentAwarenessRegistrationInput }) =>
    EnvironmentRegistry.pipe(
      Effect.flatMap((registry) =>
        registry.run(
          request.environmentId,
          Effect.gen(function* () {
            const supervisor = yield* EnvironmentSupervisor;
            const session = yield* SubscriptionRef.get(supervisor.session);
            if (Option.isNone(session)) {
              return yield* Effect.fail(
                new Error(`Environment ${request.environmentId} is not connected.`),
              );
            }
            return yield* session.value.client[WS_METHODS.agentAwarenessRegister](request.input);
          }),
        ),
      ),
    ),
});

const unregisterCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "agent-awareness:unregister",
  execute: (request: { environmentId: EnvironmentId; input: AgentAwarenessUnregistrationInput }) =>
    EnvironmentRegistry.pipe(
      Effect.flatMap((registry) =>
        registry.run(
          request.environmentId,
          Effect.gen(function* () {
            const supervisor = yield* EnvironmentSupervisor;
            const session = yield* SubscriptionRef.get(supervisor.session);
            if (Option.isNone(session)) {
              return yield* Effect.fail(
                new Error(`Environment ${request.environmentId} is not connected.`),
              );
            }
            return yield* session.value.client[WS_METHODS.agentAwarenessUnregister](request.input);
          }),
        ),
      ),
    ),
});

async function runRegistrationCommand(
  command: typeof registerCommand | typeof unregisterCommand,
  request: {
    environmentId: EnvironmentId;
    input: AgentAwarenessRegistrationInput | AgentAwarenessUnregistrationInput;
  },
): Promise<AgentAwarenessRegistrationResult> {
  const result = await command.run(appAtomRegistry, request as never);
  if (AsyncResult.isSuccess(result)) return result.value;
  throw Cause.squash(result.cause);
}

const register = (environmentId: EnvironmentId, input: AgentAwarenessRegistrationInput) =>
  runRegistrationCommand(registerCommand, { environmentId, input });

const unregister = (environmentId: EnvironmentId, input: AgentAwarenessUnregistrationInput) =>
  runRegistrationCommand(unregisterCommand, { environmentId, input });

async function readNativeDeviceToken(): Promise<string | null> {
  if (Platform.OS !== "ios" || !supportsAgentAwarenessPush()) return null;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return null;
  const token = await Notifications.getDevicePushTokenAsync();
  return token.type === "ios" && typeof token.data === "string" ? token.data.trim() || null : null;
}

export function useAgentAwarenessRemoteRegistration(): void {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const managerRef = useRef<ReturnType<typeof createAgentAwarenessRegistrationManager> | null>(
    null,
  );

  useEffect(() => {
    if (Platform.OS !== "ios" || !supportsAgentAwarenessPush()) return;
    const manager = createAgentAwarenessRegistrationManager({
      installationId: loadOrCreateAgentAwarenessDeviceId,
      readDeviceToken: readNativeDeviceToken,
      subscribeDeviceToken: (listener) =>
        Notifications.addPushTokenListener((token) => {
          if (token.type === "ios" && typeof token.data === "string") listener(token.data);
        }),
      subscribePushToStartToken: (listener) =>
        Platform.OS === "ios"
          ? addPushToStartTokenListener((event) => listener(event.activityPushToStartToken))
          : { remove: () => undefined },
      register,
      unregister,
    });
    managerRef.current = manager;
    const activitySubscriptions: Array<{ remove: () => void }> = [];
    const refreshActivityTokens = async () => {
      for (const subscription of activitySubscriptions.splice(0)) subscription.remove();
      manager.setLiveActivityToken(null);
      for (const activity of AgentActivity.getInstances()) {
        const token = await activity.getPushToken();
        if (token) manager.setLiveActivityToken(token);
        activitySubscriptions.push(
          activity.addPushTokenListener((event) => manager.setLiveActivityToken(event.pushToken)),
        );
      }
    };
    void refreshActivityTokens().catch((error: unknown) =>
      console.warn("[agent-awareness] Live Activity token registration failed", error),
    );
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshActivityTokens().catch((error: unknown) =>
          console.warn("[agent-awareness] Live Activity token refresh failed", error),
        );
      }
    });
    return () => {
      manager.stop();
      appState.remove();
      for (const subscription of activitySubscriptions) subscription.remove();
      managerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const environmentIds = connectedEnvironments
      .filter((environment) => environment.connectionState === "connected")
      .map((environment) => environment.environmentId);
    void managerRef.current
      ?.reconcile(environmentIds)
      .catch((error: unknown) =>
        console.warn("[agent-awareness] environment registration failed", error),
      );
  }, [connectedEnvironments]);

  useEffect(() => {
    const preferences = Option.getOrNull(AsyncResult.value(preferencesResult));
    managerRef.current?.setPreferences({
      notificationsEnabled: preferences?.notificationsEnabled === true,
      liveActivitiesEnabled: preferences?.liveActivitiesEnabled !== false,
    });
  }, [preferencesResult]);
}
