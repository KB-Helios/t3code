import type { AgentAwarenessRegistrationInput } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface AgentAwarenessRegistration extends AgentAwarenessRegistrationInput {
  readonly registeredAt: string;
  readonly startedPushToStartToken?: string;
}

export class AgentAwarenessRegistrationPersistenceError extends Schema.TaggedErrorClass<AgentAwarenessRegistrationPersistenceError>()(
  "AgentAwarenessRegistrationPersistenceError",
  {
    operation: Schema.Literals(["upsert", "remove", "list", "mark-started", "clear-started"]),
    cause: Schema.Defect(),
  },
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
    readonly markLiveActivityStarted: (
      installationId: string,
      pushToStartToken: string,
    ) => Effect.Effect<void, AgentAwarenessRegistrationPersistenceError>;
    readonly clearLiveActivityStarted: (
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
  readonly startedPushToStartToken: string | null;
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
    ...(row.startedPushToStartToken
      ? { startedPushToStartToken: row.startedPushToStartToken }
      : {}),
  };
}

const REGISTRATION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const mapError =
    (operation: "upsert" | "remove" | "list" | "mark-started" | "clear-started") =>
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
        registered_at,
        started_push_to_start_token
      ) VALUES (
        ${input.installationId},
        ${input.deviceToken ?? null},
        ${input.pushToStartToken ?? null},
        ${input.liveActivityToken ?? null},
        ${input.preferences.notificationsEnabled ? 1 : 0},
        ${input.preferences.liveActivitiesEnabled ? 1 : 0},
        ${registeredAt},
        NULL
      )
      ON CONFLICT (installation_id) DO UPDATE SET
        device_token = excluded.device_token,
        push_to_start_token = excluded.push_to_start_token,
        live_activity_token = excluded.live_activity_token,
        notifications_enabled = excluded.notifications_enabled,
        live_activities_enabled = excluded.live_activities_enabled,
        registered_at = excluded.registered_at,
        started_push_to_start_token = CASE
          WHEN excluded.live_activities_enabled = 1
            AND agent_awareness_registrations.push_to_start_token = excluded.push_to_start_token
          THEN agent_awareness_registrations.started_push_to_start_token
          ELSE NULL
        END
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

  const markLiveActivityStarted = Effect.fn("AgentAwarenessRegistrations.markStarted")(function* (
    installationId: string,
    pushToStartToken: string,
  ) {
    yield* sql`
        UPDATE agent_awareness_registrations
        SET started_push_to_start_token = ${pushToStartToken}
        WHERE installation_id = ${installationId}
          AND push_to_start_token = ${pushToStartToken}
          AND live_activities_enabled = 1
      `.pipe(Effect.mapError(mapError("mark-started")));
  });

  const clearLiveActivityStarted = Effect.fn("AgentAwarenessRegistrations.clearStarted")(function* (
    installationId: string,
  ) {
    yield* sql`
        UPDATE agent_awareness_registrations
        SET started_push_to_start_token = NULL
        WHERE installation_id = ${installationId}
      `.pipe(Effect.mapError(mapError("clear-started")));
  });

  const list = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const cutoff = DateTime.formatIso(
      DateTime.makeUnsafe(now.epochMilliseconds - REGISTRATION_TTL_MS),
    );
    yield* sql`
      DELETE FROM agent_awareness_registrations
      WHERE registered_at < ${cutoff}
    `;
    return yield* sql<RegistrationRow>`
      SELECT
        installation_id AS "installationId",
        device_token AS "deviceToken",
        push_to_start_token AS "pushToStartToken",
        live_activity_token AS "liveActivityToken",
        notifications_enabled AS "notificationsEnabled",
        live_activities_enabled AS "liveActivitiesEnabled",
        registered_at AS "registeredAt",
        started_push_to_start_token AS "startedPushToStartToken"
      FROM agent_awareness_registrations
      ORDER BY installation_id ASC
    `;
  }).pipe(
    Effect.map((rows) => rows.map(fromRow)),
    Effect.mapError(mapError("list")),
  );

  return AgentAwarenessRegistrations.of({
    upsert,
    remove,
    markLiveActivityStarted,
    clearLiveActivityStarted,
    list,
  });
});

export const layer = Layer.effect(AgentAwarenessRegistrations, make);
