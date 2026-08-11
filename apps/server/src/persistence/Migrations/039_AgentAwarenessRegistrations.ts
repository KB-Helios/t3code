import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_awareness_registrations (
      installation_id TEXT PRIMARY KEY,
      device_token TEXT,
      push_to_start_token TEXT,
      live_activity_token TEXT,
      notifications_enabled INTEGER NOT NULL,
      live_activities_enabled INTEGER NOT NULL,
      registered_at TEXT NOT NULL
    )
  `;
});
