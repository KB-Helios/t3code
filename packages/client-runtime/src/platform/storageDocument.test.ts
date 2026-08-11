import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  SshConnectionProfile,
  SshConnectionRegistration,
} from "../connection/catalog.ts";
import { BearerConnectionTarget, SshConnectionTarget } from "../connection/model.ts";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  registerConnectionInCatalog,
  removeConnectionFromCatalog,
} from "./storageDocument.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

const BEARER_TARGET = new BearerConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "Remote",
  connectionId: "bearer-1",
});
const BEARER_PROFILE = new BearerConnectionProfile({
  connectionId: BEARER_TARGET.connectionId,
  environmentId: ENVIRONMENT_ID,
  label: BEARER_TARGET.label,
  httpBaseUrl: "https://remote.example.test",
  wsBaseUrl: "wss://remote.example.test",
});
const BEARER_CREDENTIAL = new BearerConnectionCredential({
  token: "bearer-token",
});
const SSH_TARGET = new SshConnectionTarget({
  environmentId: EnvironmentId.make("ssh-environment"),
  label: "SSH",
  connectionId: "ssh-1",
});
const SSH_PROFILE = new SshConnectionProfile({
  connectionId: SSH_TARGET.connectionId,
  environmentId: SSH_TARGET.environmentId,
  label: SSH_TARGET.label,
  target: {
    alias: "devbox",
    hostname: "devbox.example.test",
    username: "developer",
    port: 22,
  },
});

describe("ConnectionCatalogDocument", () => {
  it("drops legacy relay records without discarding direct v1 connections", () => {
    const document = Schema.decodeUnknownSync(ConnectionCatalogDocument)({
      schemaVersion: 1,
      targets: [
        BEARER_TARGET,
        {
          _tag: "RelayConnectionTarget",
          environmentId: EnvironmentId.make("relay-environment"),
          label: "Managed Relay",
        },
        SSH_TARGET,
      ],
      profiles: [BEARER_PROFILE, SSH_PROFILE],
      credentials: [
        {
          connectionId: BEARER_TARGET.connectionId,
          credential: BEARER_CREDENTIAL,
        },
      ],
      remoteDpopTokens: [
        {
          environmentId: EnvironmentId.make("relay-environment"),
          accessToken: "ephemeral-token",
        },
      ],
    });

    expect(document).toEqual({
      schemaVersion: 1,
      targets: [BEARER_TARGET, SSH_TARGET],
      profiles: [BEARER_PROFILE, SSH_PROFILE],
      credentials: [
        {
          connectionId: BEARER_TARGET.connectionId,
          credential: BEARER_CREDENTIAL,
        },
      ],
    });
  });

  it("registers a bearer connection as one catalog mutation", () => {
    const document = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    expect(document.targets).toEqual([BEARER_TARGET]);
    expect(document.profiles).toEqual([BEARER_PROFILE]);
    expect(document.credentials).toEqual([
      {
        connectionId: BEARER_TARGET.connectionId,
        credential: BEARER_CREDENTIAL,
      },
    ]);
  });

  it("removes every catalog record owned by an explicit disconnect", () => {
    const registered = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    expect(removeConnectionFromCatalog(registered, BEARER_TARGET)).toEqual(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
    );
  });

  it("persists the normalized SSH profile beside its target", () => {
    const document = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new SshConnectionRegistration({ target: SSH_TARGET, profile: SSH_PROFILE }),
    );

    expect(document.targets).toEqual([SSH_TARGET]);
    expect(document.profiles).toEqual([SSH_PROFILE]);
    expect(document.credentials).toEqual([]);
  });
});
