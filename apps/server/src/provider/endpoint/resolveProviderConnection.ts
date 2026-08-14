/**
 * Join a provider instance's profile ids onto settings + the auth-profile
 * secret store. Drivers receive the result as `connection` and never see
 * persisted secret material on `ServerSettings`.
 *
 * @module provider/endpoint/resolveProviderConnection
 */
import type {
  AuthProfileId,
  AuthProfileMethod,
  EndpointProfile,
  EndpointProfileId,
  ProviderInstanceConfig,
  ProviderInstanceEnvironment,
  ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";

export interface ResolvedAuthProfile {
  readonly id: AuthProfileId;
  readonly name: string;
  readonly method: AuthProfileMethod;
  readonly envKey?: string;
  readonly headerName?: string;
  readonly tokenCommand?: string;
  readonly secret?: string;
}

export interface ResolvedProviderConnection {
  readonly endpoint?: { readonly id: EndpointProfileId } & EndpointProfile;
  readonly auth?: ResolvedAuthProfile;
}

export function authProfileSecretName(authProfileId: AuthProfileId): string {
  return `auth-profile/${authProfileId}`;
}

export function missingEndpointProfileMessage(id: EndpointProfileId): string {
  return `Endpoint profile '${id}' was not found`;
}

export function missingAuthProfileMessage(id: AuthProfileId): string {
  return `Auth profile '${id}' was not found`;
}

export function environmentWithResolvedAuth(
  environment: ProviderInstanceEnvironment | undefined,
  connection: ResolvedProviderConnection,
): ProviderInstanceEnvironment {
  const base = environment ?? [];
  const auth = connection.auth;
  if (
    auth === undefined ||
    (auth.method !== "bearer-env" && auth.method !== "api-key-env") ||
    auth.envKey === undefined ||
    auth.secret === undefined
  ) {
    return base;
  }
  return [...base, { name: auth.envKey, value: auth.secret, sensitive: true }];
}

const textDecoder = new TextDecoder();

export const resolveProviderConnection = Effect.fn("resolveProviderConnection")(function* (
  settings: Pick<ServerSettings, "endpointProfiles" | "authProfiles">,
  instance: Pick<ProviderInstanceConfig, "endpointProfileId" | "authProfileId">,
): Effect.fn.Return<ResolvedProviderConnection> {
  const connection: {
    endpoint?: { readonly id: EndpointProfileId } & EndpointProfile;
    auth?: ResolvedAuthProfile;
  } = {};

  if (instance.endpointProfileId !== undefined) {
    const profile = settings.endpointProfiles[instance.endpointProfileId];
    if (profile !== undefined) {
      connection.endpoint = { id: instance.endpointProfileId, ...profile };
    }
  }

  if (instance.authProfileId !== undefined) {
    const profile = settings.authProfiles[instance.authProfileId];
    if (profile !== undefined) {
      const authProfileId = instance.authProfileId;
      const secretStore = yield* Effect.serviceOption(ServerSecretStore.ServerSecretStore);
      const secret = yield* Option.match(secretStore, {
        onNone: () => Effect.succeed<string | undefined>(undefined),
        onSome: (store) =>
          store.get(authProfileSecretName(authProfileId)).pipe(
            Effect.map((bytes) =>
              Option.isSome(bytes) ? textDecoder.decode(bytes.value) : undefined,
            ),
            Effect.tapError((error) =>
              Effect.logError(
                `Failed to load auth profile secret for '${authProfileId}'`,
                error,
              ),
            ),
            Effect.orElseSucceed(() => undefined),
          ),
      });

      connection.auth = {
        id: authProfileId,
        name: profile.name,
        method: profile.method,
        ...(profile.envKey !== undefined ? { envKey: profile.envKey } : {}),
        ...(profile.headerName !== undefined ? { headerName: profile.headerName } : {}),
        ...(profile.tokenCommand !== undefined ? { tokenCommand: profile.tokenCommand } : {}),
        ...(secret !== undefined && secret.length > 0 ? { secret } : {}),
      };
    }
  }

  return connection;
});
