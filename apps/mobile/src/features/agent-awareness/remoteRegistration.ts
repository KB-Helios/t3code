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
  readonly endLiveActivities: () => Promise<void>;
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

  const payload = async (
    registrationPreferences = preferences,
  ): Promise<AgentAwarenessRegistrationInput> => ({
    installationId: await dependencies.installationId(),
    ...(deviceToken && registrationPreferences.notificationsEnabled ? { deviceToken } : {}),
    ...(pushToStartToken ? { pushToStartToken } : {}),
    ...(liveActivityToken && registrationPreferences.liveActivitiesEnabled
      ? { liveActivityToken }
      : {}),
    preferences: {
      notificationsEnabled: registrationPreferences.notificationsEnabled && deviceToken !== null,
      liveActivitiesEnabled: registrationPreferences.liveActivitiesEnabled,
    },
  });

  const registerAll = async (registrationPreferences = preferences) => {
    const input = await payload(registrationPreferences);
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
      if (added.length === 0) return;
      if (deviceToken === null && preferences.notificationsEnabled) {
        deviceToken = await dependencies.readDeviceToken();
      }
      const input = await payload();
      await Promise.all(added.map((environmentId) => dependencies.register(environmentId, input)));
    },
    setLiveActivityToken(token: string | null) {
      liveActivityToken = preferences.liveActivitiesEnabled ? token?.trim() || null : null;
      enqueue(registerAll);
    },
    setPreferences(next: typeof preferences) {
      const previous = preferences;
      preferences = next;
      enqueue(async () => {
        if (previous.liveActivitiesEnabled && !next.liveActivitiesEnabled) {
          await dependencies.endLiveActivities();
          liveActivityToken = null;
        }
        deviceToken = next.notificationsEnabled ? await dependencies.readDeviceToken() : null;
        await registerAll(next);
      });
    },
    idle: () => pending,
    stop() {
      deviceSubscription.remove();
      pushToStartSubscription.remove();
    },
  };
}

export async function removeEnvironmentWithBestEffortUnregister(input: {
  readonly unregister: () => Promise<unknown>;
  readonly remove: () => Promise<unknown>;
}): Promise<void> {
  try {
    await input.unregister();
  } catch {
    // Explicit removal must still finish when the environment is unreachable.
  }
  await input.remove();
}
