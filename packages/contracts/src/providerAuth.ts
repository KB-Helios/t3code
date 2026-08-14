/**
 * Interactive provider-auth contracts.
 *
 * Distinct from `AuthProfileMethod` (settings metadata for how an endpoint
 * attaches credentials). `ProviderAuthMethod` describes the *interactive*
 * login UX a client can start over RPC — device-code, host-local browser,
 * API key presence, or a token command.
 *
 * Secret material never belongs in these schemas. Device-code pending
 * state carries a verification URI and user code only.
 *
 * @module providerAuth
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ProviderAuthMethod = Schema.Literals([
  "device-code",
  "browser",
  "api-key",
  "token-command",
]);
export type ProviderAuthMethod = typeof ProviderAuthMethod.Type;

export const ProviderAuthFlowId = TrimmedNonEmptyString.pipe(Schema.brand("ProviderAuthFlowId"));
export type ProviderAuthFlowId = typeof ProviderAuthFlowId.Type;

export const ProviderAuthState = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("authenticated"),
    account: Schema.optional(TrimmedNonEmptyString),
    methods: Schema.optional(Schema.Array(ProviderAuthMethod)),
  }),
  Schema.Struct({
    state: Schema.Literal("unauthenticated"),
    methods: Schema.Array(ProviderAuthMethod),
  }),
  Schema.Struct({
    state: Schema.Literal("pending"),
    method: Schema.Literal("device-code"),
    flowId: ProviderAuthFlowId,
    verificationUri: TrimmedNonEmptyString,
    userCode: TrimmedNonEmptyString,
    expiresAt: IsoDateTime,
  }),
  Schema.Struct({
    state: Schema.Literal("pending"),
    method: Schema.Literal("browser"),
    flowId: ProviderAuthFlowId,
    message: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    state: Schema.Literal("error"),
    message: TrimmedNonEmptyString,
  }),
]);
export type ProviderAuthState = typeof ProviderAuthState.Type;

export const ProviderAuthInstanceInput = Schema.Struct({
  instanceId: ProviderInstanceId,
});
export type ProviderAuthInstanceInput = typeof ProviderAuthInstanceInput.Type;

export const ProviderAuthBeginInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  method: Schema.optional(ProviderAuthMethod),
});
export type ProviderAuthBeginInput = typeof ProviderAuthBeginInput.Type;

export const ProviderAuthFlowInput = Schema.Struct({
  flowId: ProviderAuthFlowId,
});
export type ProviderAuthFlowInput = typeof ProviderAuthFlowInput.Type;

export const ProviderAuthLogoutResult = Schema.Struct({});
export type ProviderAuthLogoutResult = typeof ProviderAuthLogoutResult.Type;

export class ProviderAuthError extends Schema.TaggedErrorClass<ProviderAuthError>()(
  "ProviderAuthError",
  {
    message: TrimmedNonEmptyString,
    instanceId: Schema.optional(ProviderInstanceId),
    flowId: Schema.optional(ProviderAuthFlowId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
