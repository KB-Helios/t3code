import { describe, expect, it } from "@effect/vitest";
import {
  AuthProfileId,
  DEFAULT_SERVER_SETTINGS,
  EndpointProfileId,
  ProviderDriverKind,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import {
  authProfileSecretName,
  environmentWithResolvedAuth,
  missingEndpointProfileMessage,
  resolveProviderConnection,
} from "./resolveProviderConnection.ts";

const OMNIROUTER_ENDPOINT_ID = EndpointProfileId.make("omnirouter_prod");
const OMNIROUTER_AUTH_ID = AuthProfileId.make("omnirouter_kevin");
const MISSING_ENDPOINT_ID = EndpointProfileId.make("missing_endpoint");

const settingsWithProfiles = {
  ...DEFAULT_SERVER_SETTINGS,
  endpointProfiles: {
    [OMNIROUTER_ENDPOINT_ID]: {
      name: "OmniRouter",
      baseUrl: "https://router.example/v1",
      protocol: "openai-responses" as const,
      modelDiscovery: { type: "models-endpoint" as const },
    },
  },
  authProfiles: {
    [OMNIROUTER_AUTH_ID]: {
      name: "Kevin OmniRouter",
      method: "bearer-env" as const,
      envKey: "OMNIROUTER_TOKEN",
      secretRedacted: true,
    },
  },
} satisfies ServerSettings;

const linkedInstance = {
  driver: ProviderDriverKind.make("codex"),
  endpointProfileId: OMNIROUTER_ENDPOINT_ID,
  authProfileId: OMNIROUTER_AUTH_ID,
  config: {},
};

const memorySecretStoreLayer = (secrets: Readonly<Record<string, string>>) =>
  Layer.succeed(
    ServerSecretStore.ServerSecretStore,
    ServerSecretStore.ServerSecretStore.of({
      get: (name) =>
        Effect.succeed(
          name in secrets ? Option.some(new TextEncoder().encode(secrets[name])) : Option.none(),
        ),
      set: () => Effect.void,
      create: () => Effect.void,
      getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
      remove: () => Effect.void,
    }),
  );

describe("resolveProviderConnection", () => {
  it.effect("omits endpoint and auth when the instance has no profile ids", () =>
    Effect.gen(function* () {
      const connection = yield* resolveProviderConnection(DEFAULT_SERVER_SETTINGS, {
        driver: ProviderDriverKind.make("codex"),
        config: {},
      });
      expect(connection).toEqual({});
      expect("endpoint" in connection).toBe(false);
      expect("auth" in connection).toBe(false);
    }),
  );

  it.effect("joins both profiles and loads the auth-profile secret", () =>
    Effect.gen(function* () {
      const connection = yield* resolveProviderConnection(settingsWithProfiles, linkedInstance);
      expect(connection.endpoint).toEqual({
        id: OMNIROUTER_ENDPOINT_ID,
        name: "OmniRouter",
        baseUrl: "https://router.example/v1",
        protocol: "openai-responses",
        modelDiscovery: { type: "models-endpoint" },
      });
      expect(connection.auth).toMatchObject({
        id: OMNIROUTER_AUTH_ID,
        name: "Kevin OmniRouter",
        method: "bearer-env",
        envKey: "OMNIROUTER_TOKEN",
        secret: "tok_live",
      });
    }).pipe(
      Effect.provide(
        memorySecretStoreLayer({
          [authProfileSecretName(OMNIROUTER_AUTH_ID)]: "tok_live",
        }),
      ),
    ),
  );

  it.effect("omits a dangling endpointProfileId without throwing", () =>
    Effect.gen(function* () {
      const connection = yield* resolveProviderConnection(settingsWithProfiles, {
        driver: ProviderDriverKind.make("codex"),
        endpointProfileId: MISSING_ENDPOINT_ID,
        authProfileId: OMNIROUTER_AUTH_ID,
        config: {},
      });
      expect(connection.endpoint).toBeUndefined();
      expect("endpoint" in connection).toBe(false);
      expect(connection.auth?.id).toBe(OMNIROUTER_AUTH_ID);
      expect(missingEndpointProfileMessage(MISSING_ENDPOINT_ID)).toContain("Endpoint profile");
      expect(missingEndpointProfileMessage(MISSING_ENDPOINT_ID)).toContain(MISSING_ENDPOINT_ID);
    }).pipe(
      Effect.provide(
        memorySecretStoreLayer({
          [authProfileSecretName(OMNIROUTER_AUTH_ID)]: "tok_live",
        }),
      ),
    ),
  );

  it("merges bearer-env and api-key-env secrets into process env without a persisted row", () => {
    const bearer = environmentWithResolvedAuth([], {
      auth: {
        id: OMNIROUTER_AUTH_ID,
        name: "Kevin OmniRouter",
        method: "bearer-env",
        envKey: "OMNIROUTER_TOKEN",
        secret: "tok_live",
      },
    });
    expect(bearer).toEqual([{ name: "OMNIROUTER_TOKEN", value: "tok_live", sensitive: true }]);

    const headerOnly = environmentWithResolvedAuth(
      [{ name: "KEEP_ME", value: "yes", sensitive: false }],
      {
        auth: {
          id: AuthProfileId.make("header_auth"),
          name: "Header",
          method: "header-env",
          envKey: "X_API_KEY",
          headerName: "X-Api-Key",
          secret: "hdr_live",
        },
      },
    );
    expect(headerOnly).toEqual([{ name: "KEEP_ME", value: "yes", sensitive: false }]);
  });

  it("names secrets auth-profile/<authProfileId>", () => {
    expect(authProfileSecretName(OMNIROUTER_AUTH_ID)).toBe("auth-profile/omnirouter_kevin");
  });
});
