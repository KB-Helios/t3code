import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { GrokSettings, ProviderInstanceId } from "@t3tools/contracts";

import { applyGrokEndpointConfig } from "../endpoint/grokEndpointConfig.ts";
import { omnirouterConnection } from "../endpoint/testFixtures.ts";
import {
  GROK_HOME_ENV,
  makeGrokEnvironment,
  materializeGrokHome,
  resolveGrokHomeLayout,
} from "./GrokHome.ts";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const makeTempDir = Effect.fn("GrokHome.test.makeTempDir")(function* (prefix: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix });
});

it.layer(NodeServices.layer)("GrokHome", (it) => {
  describe("resolveGrokHomeLayout", () => {
    it.effect("uses the process ~/.grok home when no override or endpoint is set", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sharedHomePath = path.resolve(path.join(NodeOS.homedir(), ".grok"));

        const layout = yield* resolveGrokHomeLayout(decodeGrokSettings({}));

        expect(layout.sharedHomePath).toBe(sharedHomePath);
        expect(layout.effectiveHomePath).toBeUndefined();
        expect(layout.isolated).toBe(false);
      }),
    );

    it.effect("honors a configured GROK_HOME path", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.grok-work";
        const resolved = path.resolve(NodeOS.homedir(), ".grok-work");

        const layout = yield* resolveGrokHomeLayout(decodeGrokSettings({ homePath }));

        expect(layout.effectiveHomePath).toBe(resolved);
        expect(layout.isolated).toBe(true);
        expect((yield* makeGrokEnvironment(decodeGrokSettings({ homePath })))[GROK_HOME_ENV]).toBe(
          resolved,
        );
      }),
    );

    it.effect("isolates an endpoint instance under stateDir/provider-homes/<id>/grok", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const stateDir = yield* makeTempDir("t3code-grok-state-");
        const instanceId = ProviderInstanceId.make("grok_omni");

        const layout = yield* resolveGrokHomeLayout(decodeGrokSettings({}), {
          instanceId,
          stateDir,
          endpointAttached: true,
        });

        expect(layout.effectiveHomePath).toBe(
          path.join(stateDir, "provider-homes", instanceId, "grok"),
        );
        expect(layout.isolated).toBe(true);
      }),
    );

    it.effect("does not set GROK_HOME when the instance uses the shared user home", () =>
      Effect.gen(function* () {
        const env = yield* makeGrokEnvironment(decodeGrokSettings({}), { XAI_API_KEY: "secret" });
        expect(env).toEqual({ XAI_API_KEY: "secret" });
        expect(env).not.toHaveProperty(GROK_HOME_ENV);
      }),
    );
  });

  it.effect(
    "does not write Grok endpoint config into the user global home when an instance home is used",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* makeTempDir("t3code-grok-state-");
        const tempSharedHome = yield* makeTempDir("t3code-grok-shared-");
        const instanceId = ProviderInstanceId.make("grok_omni");

        const isolatedLayout = yield* resolveGrokHomeLayout(
          decodeGrokSettings({ homePath: "" }),
          {
            instanceId,
            stateDir,
            endpointAttached: true,
          },
        );

        yield* materializeGrokHome(isolatedLayout);
        yield* applyGrokEndpointConfig(isolatedLayout, omnirouterConnection());

        const sharedConfigPath = path.join(tempSharedHome, "config.toml");
        const sharedExists = yield* fileSystem.exists(sharedConfigPath);
        expect(sharedExists).toBe(false);

        const instanceConfig = path.join(isolatedLayout.effectiveHomePath!, "config.toml");
        const instanceContents = yield* fileSystem.readFileString(instanceConfig);
        expect(instanceContents).toContain("[model.northbridge_omnirouter_prod]");
        expect(instanceContents).not.toContain("tok_live");

        expect(isolatedLayout.effectiveHomePath).not.toBe(tempSharedHome);
      }),
  );
});
