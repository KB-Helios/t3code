import { EndpointProfileId, type EndpointProtocol } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  apiBackendForEndpointProtocol,
  northbridgeGrokModelTable,
  upsertGrokEndpointToml,
} from "./grokEndpointConfig.ts";
import { OMNIROUTER_ENDPOINT_ID, OMNIROUTER_AUTH_ID, omnirouterConnection } from "./testFixtures.ts";

describe("apiBackendForEndpointProtocol", () => {
  it.each([
    ["openai-responses", "responses"],
    ["xai-responses", "responses"],
    ["openai-chat", "chat"],
    ["anthropic-messages", "responses"],
    ["acp", "responses"],
    ["custom", "responses"],
  ] as const satisfies ReadonlyArray<readonly [EndpointProtocol, "responses" | "chat"]>)(
    "maps %s to %s",
    (protocol, apiBackend) => {
      expect(apiBackendForEndpointProtocol(protocol)).toBe(apiBackend);
    },
  );
});

describe("upsertGrokEndpointToml", () => {
  it("generates [model.northbridge_<id>] with responses backend for openai-responses", () => {
    const toml = upsertGrokEndpointToml("", omnirouterConnection());
    expect(northbridgeGrokModelTable(OMNIROUTER_ENDPOINT_ID)).toBe("northbridge_omnirouter_prod");
    expect(toml).toContain("[model.northbridge_omnirouter_prod]");
    expect(toml).toContain('model = "default"');
    expect(toml).toContain('base_url = "https://router.example/v1"');
    expect(toml).toContain('env_key = "OMNIROUTER_TOKEN"');
    expect(toml).toContain('api_backend = "responses"');
    expect(toml).not.toContain("tok_live");
  });

  it("maps openai-chat to api_backend chat", () => {
    const toml = upsertGrokEndpointToml(
      "",
      omnirouterConnection({
        endpoint: {
          id: OMNIROUTER_ENDPOINT_ID,
          name: "OmniRouter",
          baseUrl: "https://router.example/v1",
          protocol: "openai-chat",
          modelDiscovery: { type: "models-endpoint" },
        },
      }),
    );
    expect(toml).toContain('api_backend = "chat"');
  });

  it("does not rewrite a user's unrelated config.toml keys", () => {
    const existing = ["yolo = false", "", "[ui]", "compact_mode = true"].join("\n");
    const toml = upsertGrokEndpointToml(existing, omnirouterConnection());
    expect(toml).toContain("yolo = false");
    expect(toml).toContain("[ui]");
    expect(toml).toContain("compact_mode = true");
    expect(toml).toContain("[model.northbridge_omnirouter_prod]");
  });

  it("omits env_key for oauth-browser and oauth-device", () => {
    for (const method of ["oauth-browser", "oauth-device"] as const) {
      const toml = upsertGrokEndpointToml(
        "",
        omnirouterConnection({
          auth: {
            id: OMNIROUTER_AUTH_ID,
            name: "xAI",
            method,
            envKey: "XAI_API_KEY",
            secret: "tok_live",
          },
        }),
      );
      expect(toml).not.toContain("env_key");
      expect(toml).toContain("[model.northbridge_omnirouter_prod]");
    }
  });

  it("replaces a previous northbridge model table on reconcile", () => {
    const first = upsertGrokEndpointToml("", {
      endpoint: {
        id: EndpointProfileId.make("old_router"),
        name: "Old",
        baseUrl: "https://old.example/v1",
        protocol: "openai-chat",
        modelDiscovery: { type: "models-endpoint" },
      },
    });
    const next = upsertGrokEndpointToml(first, omnirouterConnection());
    expect(next).not.toContain("northbridge_old_router");
    expect(next).toContain("[model.northbridge_omnirouter_prod]");
    expect(next).toContain('api_backend = "responses"');
  });
});
