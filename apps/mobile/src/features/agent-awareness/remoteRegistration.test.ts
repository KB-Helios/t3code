import { describe, expect, it, vi } from "vite-plus/test";
import type { AgentAwarenessRegistrationInput, EnvironmentId } from "@t3tools/contracts";

import { createAgentAwarenessRegistrationManager } from "./remoteRegistration.ts";

describe("environment-owned agent awareness registration", () => {
  it("registers each connected environment and unregisters only the removed environment", async () => {
    const register = vi.fn(
      (_environmentId: EnvironmentId, _input: AgentAwarenessRegistrationInput) =>
        Promise.resolve({ capability: "available" as const }),
    );
    const unregister = vi.fn(() => Promise.resolve({ capability: "unavailable" as const }));
    const manager = createAgentAwarenessRegistrationManager({
      installationId: () => Promise.resolve("installation-1"),
      readDeviceToken: () => Promise.resolve("native-apns-token"),
      subscribeDeviceToken: () => ({ remove: vi.fn() }),
      subscribePushToStartToken: () => ({ remove: vi.fn() }),
      register,
      unregister,
    });

    await manager.reconcile(["environment-a", "environment-b"] as never);
    expect(register.mock.calls.map(([environmentId]) => environmentId)).toEqual([
      "environment-a",
      "environment-b",
    ]);
    expect(register.mock.calls[0]![1]).toEqual({
      installationId: "installation-1",
      preferences: { notificationsEnabled: false, liveActivitiesEnabled: true },
    });

    await manager.reconcile(["environment-b"] as never);
    expect(unregister).toHaveBeenCalledWith("environment-a", {
      installationId: "installation-1",
    });
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("re-registers every connected environment when the native device token changes", async () => {
    let listener: ((token: string) => void) | null = null;
    const register = vi.fn(
      (_environmentId: EnvironmentId, _input: AgentAwarenessRegistrationInput) =>
        Promise.resolve({ capability: "available" as const }),
    );
    const manager = createAgentAwarenessRegistrationManager({
      installationId: () => Promise.resolve("installation-1"),
      readDeviceToken: () => Promise.resolve("token-1"),
      subscribeDeviceToken: (next) => {
        listener = next;
        return { remove: vi.fn() };
      },
      subscribePushToStartToken: () => ({ remove: vi.fn() }),
      register,
      unregister: vi.fn(() => Promise.resolve({ capability: "unavailable" as const })),
    });
    manager.setPreferences({ notificationsEnabled: true, liveActivitiesEnabled: true });
    await manager.idle();
    await manager.reconcile(["environment-a", "environment-b"] as never);

    listener!("token-2");
    await manager.idle();

    expect(register).toHaveBeenCalledTimes(4);
    expect(register.mock.calls.slice(2).map(([, payload]) => payload.deviceToken)).toEqual([
      "token-2",
      "token-2",
    ]);
  });

  it("reads the native token after notification permission is enabled", async () => {
    const register = vi.fn(() => Promise.resolve({ capability: "available" as const }));
    const readDeviceToken = vi.fn(() => Promise.resolve("native-token"));
    const manager = createAgentAwarenessRegistrationManager({
      installationId: () => Promise.resolve("installation-1"),
      readDeviceToken,
      subscribeDeviceToken: () => ({ remove: vi.fn() }),
      subscribePushToStartToken: () => ({ remove: vi.fn() }),
      register,
      unregister: vi.fn(),
    });
    await manager.reconcile(["environment-a"] as never);

    manager.setPreferences({ notificationsEnabled: true, liveActivitiesEnabled: true });
    await manager.idle();

    expect(readDeviceToken).toHaveBeenCalledOnce();
    expect(register).toHaveBeenLastCalledWith(
      "environment-a",
      expect.objectContaining({
        deviceToken: "native-token",
        preferences: { notificationsEnabled: true, liveActivitiesEnabled: true },
      }),
    );
  });

  it("cleans up native token listeners", () => {
    const deviceSubscription = { remove: vi.fn() };
    const activitySubscription = { remove: vi.fn() };
    const manager = createAgentAwarenessRegistrationManager({
      installationId: () => Promise.resolve("installation-1"),
      readDeviceToken: () => Promise.resolve(null),
      subscribeDeviceToken: () => deviceSubscription,
      subscribePushToStartToken: () => activitySubscription,
      register: vi.fn(),
      unregister: vi.fn(),
    });

    manager.stop();

    expect(deviceSubscription.remove).toHaveBeenCalledOnce();
    expect(activitySubscription.remove).toHaveBeenCalledOnce();
  });
});
