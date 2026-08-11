import type {
  AgentAwarenessRegistrationInput,
  AgentAwarenessRegistrationResult,
  AgentAwarenessUnregistrationInput,
  EnvironmentId,
} from "@t3tools/contracts";

interface Subscription {
  readonly remove: () => void;
}

export interface AgentAwarenessRegistrationDependencies {
  readonly installationId: () => Promise<string>;
  readonly readDeviceToken: () => Promise<string | null>;
  readonly subscribeDeviceToken: (listener: (token: string) => void) => Subscription;
  readonly subscribePushToStartToken: (listener: (token: string) => void) => Subscription;
  readonly register: (
    environmentId: EnvironmentId,
    input: AgentAwarenessRegistrationInput,
  ) => Promise<AgentAwarenessRegistrationResult>;
  readonly unregister: (
    environmentId: EnvironmentId,
    input: AgentAwarenessUnregistrationInput,
  ) => Promise<AgentAwarenessRegistrationResult>;
}

export function createAgentAwarenessRegistrationManager(
  dependencies: AgentAwarenessRegistrationDependencies,
) {
  const environments = new Set<EnvironmentId>();
  let deviceToken: string | null = null;
  let pushToStartToken: string | null = null;
  let liveActivityToken: string | null = null;
  let preferences = { notificationsEnabled: false, liveActivitiesEnabled: true };
  let pending = Promise.resolve();

  const payload = async (): Promise<AgentAwarenessRegistrationInput> => ({
    installationId: await dependencies.installationId(),
    ...(deviceToken && preferences.notificationsEnabled ? { deviceToken } : {}),
    ...(pushToStartToken ? { pushToStartToken } : {}),
    ...(liveActivityToken ? { liveActivityToken } : {}),
    preferences: {
      notificationsEnabled: preferences.notificationsEnabled && deviceToken !== null,
      liveActivitiesEnabled: preferences.liveActivitiesEnabled,
    },
  });

  const registerAll = async () => {
    const input = await payload();
    await Promise.all(
      [...environments].map((environmentId) => dependencies.register(environmentId, input)),
    );
  };

  const enqueue = (operation: () => Promise<void>) => {
    pending = pending.then(operation, operation);
  };

  const deviceSubscription = dependencies.subscribeDeviceToken((token) => {
    deviceToken = token.trim() || null;
    enqueue(registerAll);
  });
  const pushToStartSubscription = dependencies.subscribePushToStartToken((token) => {
    pushToStartToken = token.trim() || null;
    enqueue(registerAll);
  });

  return {
    async reconcile(nextEnvironmentIds: ReadonlyArray<EnvironmentId>) {
      const next = new Set(nextEnvironmentIds);
      const removed = [...environments].filter((environmentId) => !next.has(environmentId));
      const added = [...next].filter((environmentId) => !environments.has(environmentId));
      for (const environmentId of removed) environments.delete(environmentId);
      for (const environmentId of added) environments.add(environmentId);
      const installationId = await dependencies.installationId();
      await Promise.all(
        removed.map((environmentId) => dependencies.unregister(environmentId, { installationId })),
      );
      if (added.length === 0) return;
      if (deviceToken === null && preferences.notificationsEnabled) {
        deviceToken = await dependencies.readDeviceToken();
      }
      const input = await payload();
      await Promise.all(added.map((environmentId) => dependencies.register(environmentId, input)));
    },
    setLiveActivityToken(token: string | null) {
      liveActivityToken = token?.trim() || null;
      enqueue(registerAll);
    },
    setPreferences(next: typeof preferences) {
      preferences = next;
      enqueue(async () => {
        deviceToken = next.notificationsEnabled ? await dependencies.readDeviceToken() : null;
        await registerAll();
      });
    },
    idle: () => pending,
    stop() {
      deviceSubscription.remove();
      pushToStartSubscription.remove();
    },
  };
}
