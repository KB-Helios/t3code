import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  providerAuthControlsModel,
  createAuthCommandRunner,
} from "@t3tools/client-runtime/state/providerAuth";
import type { EnvironmentId, ProviderAuthState, ProviderInstanceId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useContext, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironments } from "../../state/environments";
import { providerAuth } from "../../state/providerAuth";
import { useAtomCommand } from "../../state/use-atom-command";

export function ProviderAuthScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Provider sign-in" onBack={() => navigation.goBack()} />
        </>
      ) : (
        <NativeStackScreenOptions options={{ title: "Provider sign-in" }} />
      )}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
        }}
      >
        {connected.length === 0 ? (
          <Text className="text-sm text-foreground-muted">
            Connect an environment to sign in a provider from this device.
          </Text>
        ) : (
          connected.map((environment) => (
            <View key={environment.environmentId} className="gap-3">
              <Text className="px-1 text-sm font-medium text-foreground-muted">
                {environment.label}
              </Text>
              <View className="overflow-hidden rounded-[24px] bg-card">
                {(environment.serverConfig?.providers ?? [])
                  .filter((provider) => {
                    const model = providerAuthControlsModel(
                      provider.auth?.status === "authenticated"
                        ? { state: "authenticated", methods: [] }
                        : provider.auth?.status === "unauthenticated"
                          ? { state: "unauthenticated", methods: [] }
                          : undefined,
                    );
                    return model.canSignIn || model.canSignOut || model.canCancel;
                  })
                  .map((provider, index) => (
                    <View
                      key={provider.instanceId}
                      className={index === 0 ? undefined : "border-t border-border"}
                    >
                      <ProviderAuthRow
                        environmentId={environment.environmentId}
                        instanceId={provider.instanceId}
                        displayName={provider.displayName ?? String(provider.driver)}
                      />
                    </View>
                  ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ProviderAuthRow(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
}) {
  const registry = useContext(RegistryContext);
  const statusAtom = providerAuth.getStatus({
    environmentId: props.environmentId,
    input: { instanceId: props.instanceId },
  });
  const statusResult = useAtomValue(statusAtom);
  const status = Option.getOrUndefined(AsyncResult.value(statusResult)) as
    | ProviderAuthState
    | undefined;
  const model = providerAuthControlsModel(status);
  const begin = useAtomCommand(providerAuth.begin, { reportFailure: false });
  const cancel = useAtomCommand(providerAuth.cancel, { reportFailure: false });
  const logout = useAtomCommand(providerAuth.logout, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | undefined>(undefined);
  const pendingFlowId = status?.state === "pending" ? status.flowId : undefined;

  const run = useCallback(
    createAuthCommandRunner(registry, statusAtom, setBusy, setCommandError),
    [registry, statusAtom],
  );

  return (
    <View className="gap-2 p-4">
      <Text className="text-lg text-foreground">{props.displayName}</Text>
      {commandError ? (
        <Text className="text-sm text-danger-foreground">{commandError}</Text>
      ) : model.deviceCode ? (
        <Text className="text-sm text-foreground-muted">{model.deviceCode.mobileMessage}</Text>
      ) : model.browser ? (
        <Text className="text-sm text-foreground-muted">{model.browser.message}</Text>
      ) : model.account ? (
        <Text className="text-sm text-foreground-muted">{model.account}</Text>
      ) : model.error ? (
        <Text className="text-sm text-danger-foreground">{model.error}</Text>
      ) : null}
      <View className="flex-row gap-3">
        {model.canSignIn ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            style={({ pressed }) => [
              { padding: 8, minHeight: 44, minWidth: 44 },
              pressed && { opacity: 0.7 },
              busy && { opacity: 0.5 },
            ]}
            onPress={() =>
              void run(() =>
                begin({
                  environmentId: props.environmentId,
                  input: {
                    instanceId: props.instanceId,
                    ...(model.signInMethod !== undefined ? { method: model.signInMethod } : {}),
                  },
                }),
              )
            }
          >
            <Text className="text-base text-foreground">Sign in</Text>
          </Pressable>
        ) : null}
        {model.canSignOut ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            style={({ pressed }) => [
              { padding: 8, minHeight: 44, minWidth: 44 },
              pressed && { opacity: 0.7 },
              busy && { opacity: 0.5 },
            ]}
            onPress={() =>
              void run(() =>
                logout({
                  environmentId: props.environmentId,
                  input: { instanceId: props.instanceId },
                }),
              )
            }
          >
            <Text className="text-base text-foreground">Sign out</Text>
          </Pressable>
        ) : null}
        {model.canCancel && pendingFlowId ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            style={({ pressed }) => [
              { padding: 8, minHeight: 44, minWidth: 44 },
              pressed && { opacity: 0.7 },
              busy && { opacity: 0.5 },
            ]}
            onPress={() =>
              void run(() =>
                cancel({
                  environmentId: props.environmentId,
                  input: { flowId: pendingFlowId },
                }),
              )
            }
          >
            <Text className="text-base text-foreground">Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
