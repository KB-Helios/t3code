/**
 * Endpoint and auth profile contracts.
 *
 * Reusable connection envelopes referenced by `ProviderInstanceConfig` via
 * `endpointProfileId` / `authProfileId`. Profiles describe how to reach an
 * API (URL, protocol, discovery) and how to authenticate (method + metadata).
 * Secret material is never carried in these schemas' client encoding —
 * `secretRedacted` is a presence flag only, matching the `ServerSecretStore`
 * redaction convention (`value` empty + `valueRedacted`).
 *
 * @module endpointProfile
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  AuthProfileId,
  EndpointProfileId,
  ProviderInstanceEnvironmentVariableName,
} from "./providerInstance.ts";

export { AuthProfileId, EndpointProfileId };

export const EndpointProtocol = Schema.Literals([
  "openai-responses",
  "openai-chat",
  "anthropic-messages",
  "xai-responses",
  "acp",
  "custom",
]);
export type EndpointProtocol = typeof EndpointProtocol.Type;

export const EndpointModelDiscovery = Schema.Union([
  Schema.Struct({ type: Schema.Literal("models-endpoint") }),
  Schema.Struct({ type: Schema.Literal("static"), models: Schema.Array(TrimmedNonEmptyString) }),
  Schema.Struct({ type: Schema.Literal("harness") }),
]);
export type EndpointModelDiscovery = typeof EndpointModelDiscovery.Type;

export const EndpointProfile = Schema.Struct({
  name: TrimmedNonEmptyString,
  baseUrl: TrimmedNonEmptyString,
  protocol: EndpointProtocol,
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  query: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  modelDiscovery: EndpointModelDiscovery.pipe(
    Schema.withDecodingDefault(Effect.succeed({ type: "models-endpoint" as const })),
  ),
  capabilities: Schema.optionalKey(
    Schema.Struct({
      streaming: Schema.optionalKey(Schema.Boolean),
      websocket: Schema.optionalKey(Schema.Boolean),
      tools: Schema.optionalKey(Schema.Boolean),
      reasoning: Schema.optionalKey(Schema.Boolean),
      images: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});
export type EndpointProfile = typeof EndpointProfile.Type;

export const AuthProfileMethod = Schema.Literals([
  "none",
  "bearer-env",
  "api-key-env",
  "header-env",
  "token-command",
  "oauth-device",
  "oauth-browser",
]);
export type AuthProfileMethod = typeof AuthProfileMethod.Type;

// Metadata only. Secret material is never in this schema's client encoding.
export const AuthProfile = Schema.Struct({
  name: TrimmedNonEmptyString,
  method: AuthProfileMethod,
  envKey: Schema.optionalKey(ProviderInstanceEnvironmentVariableName),
  headerName: Schema.optionalKey(TrimmedNonEmptyString),
  tokenCommand: Schema.optionalKey(TrimmedNonEmptyString),
  secretRedacted: Schema.optionalKey(Schema.Boolean),
});
export type AuthProfile = typeof AuthProfile.Type;

export const EndpointProfileMap = Schema.Record(EndpointProfileId, EndpointProfile);
export type EndpointProfileMap = typeof EndpointProfileMap.Type;

export const AuthProfileMap = Schema.Record(AuthProfileId, AuthProfile);
export type AuthProfileMap = typeof AuthProfileMap.Type;
