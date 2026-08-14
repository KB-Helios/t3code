import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CodexSettings,
  type EndpointProtocol,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { materializeCodexShadowHome, resolveCodexHomeLayout } from "../Drivers/CodexHomeLayout.ts";
import { endpointAuthSuppressesCodexLogin } from "../Layers/CodexProvider.ts";
import {
  applyCodexEndpointConfig,
  CODEX_ENDPOINT_MANAGED_COMMENT,
  northbridgeCodexProviderSlug,
  upsertCodexEndpointToml,
  wireApiForEndpointProtocol,
} from "./codexEndpointConfig.ts";
import {
  OMNIROUTER_ENDPOINT_ID,
  OMNIROUTER_AUTH_ID,
  omnirouterConnection,
} from "./testFixtures.ts";

const makeTempDir = Effect.fn("codexEndpointConfig.test.makeTempDir")(function* (prefix: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix });
});

const writeTextFile = Effect.fn("codexEndpointConfig.test.writeTextFile")(function* (
  filePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fileSystem.writeFileString(filePath, contents);
});

describe("wireApiForEndpointProtocol", () => {
  it.each([
    ["openai-responses", "responses"],
    ["xai-responses", "responses"],
    ["openai-chat", "chat"],
    ["anthropic-messages", "responses"],
    ["acp", "responses"],
    ["custom", "responses"],
  ] as const satisfies ReadonlyArray<readonly [EndpointProtocol, "responses" | "chat"]>)(
    "maps %s to %s",
    (protocol, wireApi) => {
      expect(wireApiForEndpointProtocol(protocol)).toBe(wireApi);
    },
  );
});

describe("upsertCodexEndpointToml", () => {
  it("writes a model_providers table for the OmniRouter fixture", () => {
    const toml = upsertCodexEndpointToml("", omnirouterConnection());
    expect(toml).toContain(CODEX_ENDPOINT_MANAGED_COMMENT);
    expect(toml).toContain('model_provider = "northbridge_omnirouter_prod"');
    expect(toml).toContain("[model_providers.northbridge_omnirouter_prod]");
    expect(toml).toContain('name = "OmniRouter"');
    expect(toml).toContain('base_url = "https://router.example/v1"');
    expect(toml).toContain('wire_api = "responses"');
    expect(toml).toContain('env_key = "OMNIROUTER_TOKEN"');
    expect(northbridgeCodexProviderSlug(OMNIROUTER_ENDPOINT_ID)).toBe(
      "northbridge_omnirouter_prod",
    );
  });

  it("does not rewrite a user's unrelated config.toml keys", () => {
    const existing = [
      'approval_policy = "never"',
      'model = "gpt-5-codex"',
      "",
      "[mcp_servers.github]",
      'command = "uvx"',
    ].join("\n");
    const toml = upsertCodexEndpointToml(existing, omnirouterConnection());
    expect(toml).toContain('approval_policy = "never"');
    expect(toml).toContain('model = "gpt-5-codex"');
    expect(toml).toContain("[mcp_servers.github]");
    expect(toml).toContain('command = "uvx"');
    expect(toml).toContain("[model_providers.northbridge_omnirouter_prod]");
  });

  it("keeps model_provider in the top-level preamble and preserves profile table selectors", () => {
    const existing = [
      'approval_policy = "never"',
      "",
      "[mcp_servers.github]",
      'command = "uvx"',
      "",
      "[profiles.work]",
      'model_provider = "openai"',
    ].join("\n");
    const toml = upsertCodexEndpointToml(existing, omnirouterConnection());
    const firstTable = toml.split(/\r?\n/).findIndex((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith("[") && trimmed.endsWith("]");
    });
    expect(firstTable).toBeGreaterThan(0);
    const preamble = toml.split(/\r?\n/).slice(0, firstTable).join("\n");
    expect(preamble).toMatch(/^model_provider\s*=\s*"northbridge_omnirouter_prod"\s*$/m);
    expect(preamble).toContain('approval_policy = "never"');
    expect(preamble).not.toContain("[mcp_servers.github]");
    expect(toml).toMatch(/\[profiles\.work\][^\[]*model_provider\s*=\s*"openai"/);
    expect(toml).toContain("[mcp_servers.github]");
    expect(toml).toContain('command = "uvx"');
  });

  it("does not put the OmniRouter token into generated config", () => {
    const toml = upsertCodexEndpointToml("", omnirouterConnection());
    expect(toml).not.toContain("tok_live");
  });

  it("omits env_key for oauth-browser and oauth-device", () => {
    for (const method of ["oauth-browser", "oauth-device"] as const) {
      const toml = upsertCodexEndpointToml(
        "",
        omnirouterConnection({
          auth: {
            id: OMNIROUTER_AUTH_ID,
            name: "ChatGPT",
            method,
            envKey: "OPENAI_API_KEY",
            secret: "tok_live",
          },
        }),
      );
      expect(toml).not.toContain("env_key");
      expect(toml).toContain("[model_providers.northbridge_omnirouter_prod]");
    }
  });

  it("suppresses Codex login copy when endpoint auth is present", () => {
    expect(endpointAuthSuppressesCodexLogin(omnirouterConnection())).toBe(true);
    expect(endpointAuthSuppressesCodexLogin({})).toBe(false);
    expect(
      endpointAuthSuppressesCodexLogin(
        omnirouterConnection({
          auth: {
            id: OMNIROUTER_AUTH_ID,
            name: "ChatGPT",
            method: "oauth-browser",
          },
        }),
      ),
    ).toBe(false);
  });

  it("replaces a previous northbridge table on reconcile", () => {
    const first = upsertCodexEndpointToml("", {
      endpoint: {
        id: EndpointProfileId.make("old_router"),
        name: "Old",
        baseUrl: "https://old.example/v1",
        protocol: "openai-chat",
        modelDiscovery: { type: "models-endpoint" },
      },
    });
    const next = upsertCodexEndpointToml(first, omnirouterConnection());
    expect(next).not.toContain("northbridge_old_router");
    expect(next).toContain("[model_providers.northbridge_omnirouter_prod]");
    expect(next).toContain('wire_api = "responses"');
  });
});

it.layer(NodeServices.layer)("applyCodexEndpointConfig", (it) => {
  it.effect("writes a private config.toml model_providers table into the shadow home", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sharedHome = yield* makeTempDir("t3code-codex-shared-");
      const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
      const shadowHome = path.join(shadowRoot, "shadow");

      yield* writeTextFile(path.join(sharedHome, "config.toml"), 'approval_policy = "never"\n');
      yield* writeTextFile(path.join(sharedHome, "auth.json"), '{"shared":true}\n');
      yield* writeTextFile(path.join(shadowHome, "auth.json"), '{"shadow":true}\n');

      const layout = yield* resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath: sharedHome,
          shadowHomePath: shadowHome,
        }),
        { endpointAttached: true },
      );
      yield* materializeCodexShadowHome(layout);
      yield* applyCodexEndpointConfig(layout, omnirouterConnection());

      const configPath = path.join(shadowHome, "config.toml");
      const contents = yield* fileSystem.readFileString(configPath);
      const linkResult = yield* fileSystem.readLink(configPath).pipe(Effect.result);

      expect(linkResult._tag).toBe("Failure");
      expect(contents).toContain('model_provider = "northbridge_omnirouter_prod"');
      expect(contents).toContain("[model_providers.northbridge_omnirouter_prod]");
      expect(contents).toContain(CODEX_ENDPOINT_MANAGED_COMMENT);
      expect(contents).toContain('approval_policy = "never"');
      expect(contents).not.toContain("tok_live");

      const authContents = yield* fileSystem.readFileString(path.join(shadowHome, "auth.json"));
      expect(authContents).toContain("shadow");
      expect(authContents).not.toContain("tok_live");
    }),
  );
});
