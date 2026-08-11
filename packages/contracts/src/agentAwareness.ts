import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AgentAwarenessPreferences = Schema.Struct({
  notificationsEnabled: Schema.Boolean,
  liveActivitiesEnabled: Schema.Boolean,
});
export type AgentAwarenessPreferences = typeof AgentAwarenessPreferences.Type;

export const AgentAwarenessRegistrationInput = Schema.Struct({
  installationId: TrimmedNonEmptyString,
  deviceToken: Schema.optional(TrimmedNonEmptyString),
  pushToStartToken: Schema.optional(TrimmedNonEmptyString),
  liveActivityToken: Schema.optional(TrimmedNonEmptyString),
  preferences: AgentAwarenessPreferences,
});
export type AgentAwarenessRegistrationInput = typeof AgentAwarenessRegistrationInput.Type;

export const AgentAwarenessUnregistrationInput = Schema.Struct({
  installationId: TrimmedNonEmptyString,
});
export type AgentAwarenessUnregistrationInput = typeof AgentAwarenessUnregistrationInput.Type;

export const AgentAwarenessCapability = Schema.Literals(["available", "unavailable"]);
export type AgentAwarenessCapability = typeof AgentAwarenessCapability.Type;

export const AgentAwarenessRegistrationResult = Schema.Struct({
  capability: AgentAwarenessCapability,
  registeredAt: Schema.optional(IsoDateTime),
  reason: Schema.optional(Schema.Literal("apns-not-configured")),
});
export type AgentAwarenessRegistrationResult = typeof AgentAwarenessRegistrationResult.Type;

export class AgentAwarenessRegistrationError extends Schema.TaggedErrorClass<AgentAwarenessRegistrationError>()(
  "AgentAwarenessRegistrationError",
  { message: Schema.String },
) {}
