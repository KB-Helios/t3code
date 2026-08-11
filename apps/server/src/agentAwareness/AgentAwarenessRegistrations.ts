import type { AgentAwarenessRegistrationInput } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface AgentAwarenessRegistration extends AgentAwarenessRegistrationInput {
  readonly registeredAt: string;
}

export class AgentAwarenessRegistrationPersistenceError extends Schema.TaggedErrorClass<AgentAwarenessRegistrationPersistenceError>()(
  "AgentAwarenessRegistrationPersistenceError",
  { operation: Schema.Literals(["upsert", "remove", "list"]), cause: Schema.Defect() },
) {
  override get message(): string {
    return `Failed to ${this.operation} the environment's mobile registrations.`;
  }
}

export class AgentAwarenessRegistrations extends Context.Service<
  AgentAwarenessRegistrations,
  {
    readonly upsert: (
      input: AgentAwarenessRegistrationInput,
    ) => Effect.Effect<AgentAwarenessRegistration, AgentAwarenessRegistrationPersistenceError>;
    readonly remove: (
      installationId: string,
    ) => Effect.Effect<void, AgentAwarenessRegistrationPersistenceError>;
    readonly list: Effect.Effect<
      ReadonlyArray<AgentAwarenessRegistration>,
      AgentAwarenessRegistrationPersistenceError
    >;
  }
>()("t3/agentAwareness/AgentAwarenessRegistrations") {}

interface RegistrationRow {
  readonly installationId: string;
  readonly deviceToken: string | null;
  readonly pushToStartToken: string | null;
  readonly liveActivityToken: string | null;
  readonly notificationsEnabled: number;
  readonly liveActivitiesEnabled: number;
  readonly registeredAt: string;
}

function fromRow(row: RegistrationRow): AgentAwarenessRegistration {
  return {
    installationId: row.installationId,
    ...(row.deviceToken ? { deviceToken: row.deviceToken } : {}),
    ...(row.pushToStartToken ? { pushToStartToken: row.pushToStartToken } : {}),
    ...(row.liveActivityToken ? { liveActivityToken: row.liveActivityToken } : {}),
    preferences: {
      notificationsEnabled: row.notificationsEnabled === 1,
      liveActivitiesEnabled: row.liveActivitiesEnabled === 1,
    },
    registeredAt: row.registeredAt,
  };
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const mapError =
    (operation: "upsert" | "remove" | "list") =>
    (cause: unknown): AgentAwarenessRegistrationPersistenceError =>
      new AgentAwarenessRegistrationPersistenceError({ operation, cause });

  const upsert = Effect.fn("AgentAwarenessRegistrations.upsert")(function* (
    input: AgentAwarenessRegistrationInput,
  ) {
    const registeredAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO agent_awareness_registrations (
        installation_id,
        device_token,
        push_to_start_token,
        live_activity_token,
        notifications_enabled,
        live_activities_enabled,
        registered_at
      ) VALUES (
        ${input.installationId},
        ${input.deviceToken ?? null},
        ${input.pushToStartToken ?? null},
        ${input.liveActivityToken ?? null},
        ${input.preferences.notificationsEnabled ? 1 : 0},
        ${input.preferences.liveActivitiesEnabled ? 1 : 0},
        ${registeredAt}
      )
      ON CONFLICT (installation_id) DO UPDATE SET
        device_token = excluded.device_token,
        push_to_start_token = excluded.push_to_start_token,
        live_activity_token = excluded.live_activity_token,
        notifications_enabled = excluded.notifications_enabled,
        live_activities_enabled = excluded.live_activities_enabled,
        registered_at = excluded.registered_at
    `.pipe(Effect.mapError(mapError("upsert")));
    return { ...input, registeredAt };
  });

  const remove = Effect.fn("AgentAwarenessRegistrations.remove")(function* (
    installationId: string,
  ) {
    yield* sql`
      DELETE FROM agent_awareness_registrations
      WHERE installation_id = ${installationId}
    `.pipe(Effect.mapError(mapError("remove")));
  });

  const list = sql<RegistrationRow>`
    SELECT
      installation_id AS "installationId",
      device_token AS "deviceToken",
      push_to_start_token AS "pushToStartToken",
      live_activity_token AS "liveActivityToken",
      notifications_enabled AS "notificationsEnabled",
      live_activities_enabled AS "liveActivitiesEnabled",
      registered_at AS "registeredAt"
    FROM agent_awareness_registrations
    ORDER BY installation_id ASC
  `.pipe(
    Effect.map((rows) => rows.map(fromRow)),
    Effect.mapError(mapError("list")),
  );

  return AgentAwarenessRegistrations.of({ upsert, remove, list });
});

export const layer = Layer.effect(AgentAwarenessRegistrations, make);
