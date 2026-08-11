import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";

describe("AgentAwarenessRegistrations", () => {
  it.effect("upserts one environment-local row per installation", () =>
    Effect.gen(function* () {
      const module = yield* Effect.promise(() =>
        import("./AgentAwarenessRegistrations.ts").catch(() => null),
      );
      expect(module).not.toBeNull();
      if (!module) return;

      const registrations = yield* module.AgentAwarenessRegistrations;
      yield* registrations.upsert({
        installationId: "installation-1",
        deviceToken: "old-token",
        preferences: { notificationsEnabled: true, liveActivitiesEnabled: true },
      });
      yield* registrations.upsert({
        installationId: "installation-1",
        deviceToken: "new-token",
        preferences: { notificationsEnabled: true, liveActivitiesEnabled: false },
      });

      expect(yield* registrations.list).toEqual([
        expect.objectContaining({
          installationId: "installation-1",
          deviceToken: "new-token",
          preferences: { notificationsEnabled: true, liveActivitiesEnabled: false },
        }),
      ]);
    }).pipe(
      Effect.provide(
        Layer.unwrap(
          Effect.promise(() =>
            import("./AgentAwarenessRegistrations.ts").then((module) => module.layer),
          ),
        ).pipe(Layer.provide(SqlitePersistenceMemory)),
      ),
    ),
  );

  it.effect("removes only the requested installation", () =>
    Effect.gen(function* () {
      const module = yield* Effect.promise(() => import("./AgentAwarenessRegistrations.ts"));
      const registrations = yield* module.AgentAwarenessRegistrations;
      for (const installationId of ["installation-1", "installation-2"]) {
        yield* registrations.upsert({
          installationId,
          preferences: { notificationsEnabled: false, liveActivitiesEnabled: true },
        });
      }
      yield* registrations.remove("installation-1");
      expect((yield* registrations.list).map((row) => row.installationId)).toEqual([
        "installation-2",
      ]);
    }).pipe(
      Effect.provide(
        Layer.unwrap(
          Effect.promise(() =>
            import("./AgentAwarenessRegistrations.ts").then((module) => module.layer),
          ),
        ).pipe(Layer.provide(SqlitePersistenceMemory)),
      ),
    ),
  );
});
