/**
 * Multi-instance validation slices for `ProviderInstanceRegistryLive`.
 *
 * Two axes of the driver/registry refactor are exercised here:
 *
 *  1. **Same driver, many instances** — the "multi-instance codex slice"
 *     describe block below configures two independent `codex` instances and
 *     asserts each gets its own closures and identity. This is the
 *     multi-codex capability the refactor exists to unlock.
 *
 *  2. **Many drivers, one registry** — the "all drivers slice" describe
 *     block below configures one instance of every shipped driver
 *     (`codex`, `claudeAgent`, `cursor`, `grok`, `opencode`) in a single
 *     `ProviderInstanceConfigMap` and asserts the registry boots them all
 *     without cross-contamination. This proves the driver SPI is uniform
 *     across every provider — any driver plugs into the registry through
 *     the same `ProviderDriver` value contract.
 *
 * Every instance in these tests is configured with `enabled: false` so the
 * provider-status checks short-circuit to pending/disabled snapshots
 * without trying to spawn real `codex` / `claude` / `agent` / `grok` / `opencode`
 * binaries. That keeps the assertions focused on registry routing
 * behaviour rather than the runtime details of each provider.
 */
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthProfileId,
  type ClaudeSettings,
  type CodexSettings,
  type CursorSettings,
  EndpointProfileId,
  type GrokSettings,
  type OpenCodeSettings,
  ProviderDriverKind,
  type ProviderInstanceConfigMap,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService, layer as serverSettingsLayer } from "../../serverSettings.ts";
import { ClaudeDriver } from "../Drivers/ClaudeDriver.ts";
import { CodexDriver } from "../Drivers/CodexDriver.ts";
import { CursorDriver } from "../Drivers/CursorDriver.ts";
import { GrokDriver } from "../Drivers/GrokDriver.ts";
import { OpenCodeDriver } from "../Drivers/OpenCodeDriver.ts";
import { OpenCodeRuntimeLive } from "../opencodeRuntime.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderDriverCreateInput,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  authProfileSecretName,
  resolveProviderConnection,
} from "../endpoint/resolveProviderConnection.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { makeCodexProviderAuth, ProviderAuth, ProviderAuthLive } from "./ProviderAuth.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "./ProviderEventLoggers.ts";
import { makeProviderInstanceRegistry } from "./ProviderInstanceRegistryLive.ts";

const TestHttpClientLive = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ version: "0.0.0" }))),
  ),
);

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const posixHomeGroupKey = (value: string | undefined) =>
  value?.replaceAll("\\", "/").replace(/^((?:codex|claude):home:)[A-Za-z]:/, "$1");

const BackgroundPolicyAlwaysRunLayer = Layer.mock(BackgroundPolicy.BackgroundPolicy)({
  reportClientActivity: () => Effect.void,
  removeRpcClient: () => Effect.void,
  reportHostPowerState: () => Effect.void,
  snapshot: Effect.succeed({
    hostPower: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: true,
      updatedAt: TEST_EPOCH,
    },
    leases: [],
    activeForegroundLeaseCount: 0,
    activeScopeKeys: [],
    shouldRunOpportunisticWork: true,
    updatedAt: TEST_EPOCH,
  }),
  streamChanges: Stream.empty,
  hasDemand: () => Effect.succeed(true),
  shouldRunScopeWork: () => Effect.succeed(true),
  shouldRunOpportunisticWork: Effect.succeed(true),
});

const makeCodexConfig = (overrides: Partial<CodexSettings>): CodexSettings => ({
  enabled: false,
  binaryPath: "codex",
  homePath: "",
  shadowHomePath: "",
  launchArgs: "",
  customModels: [],
  ...overrides,
});

const makeClaudeConfig = (overrides: Partial<ClaudeSettings>): ClaudeSettings => ({
  enabled: false,
  binaryPath: "claude",
  homePath: "",
  customModels: [],
  launchArgs: "",
  ...overrides,
});

const makeCursorConfig = (overrides: Partial<CursorSettings>): CursorSettings => ({
  enabled: false,
  binaryPath: "cursor-agent",
  apiEndpoint: "",
  customModels: [],
  ...overrides,
});

const makeGrokConfig = (overrides: Partial<GrokSettings>): GrokSettings => ({
  enabled: false,
  binaryPath: "grok",
  homePath: "",
  customModels: [],
  ...overrides,
});

const makeOpenCodeConfig = (overrides: Partial<OpenCodeSettings>): OpenCodeSettings => ({
  enabled: false,
  binaryPath: "opencode",
  serverUrl: "",
  serverPassword: "",
  customModels: [],
  ...overrides,
});

describe("ProviderInstanceRegistryLive — multi-instance codex slice", () => {
  // `ServerConfig.layerTest` needs `FileSystem` to materialize its scratch
  // directory. `Layer.merge` just unions requirements, so we have to push
  // `NodeServices.layer` through `Layer.provideMerge` to satisfy that
  // dependency while still surfacing NodeServices to the test body (the
  // codex driver's `create` yields `ChildProcessSpawner` directly).
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "provider-instance-registry-test",
  }).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(TestHttpClientLive),
    Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  );

  it.live("boots two independent codex instances from a ProviderInstanceConfigMap", () =>
    Effect.gen(function* () {
      const personalId = ProviderInstanceId.make("codex_personal");
      const workId = ProviderInstanceId.make("codex_work");
      const codexDriverKind = ProviderDriverKind.make("codex");

      const configMap: ProviderInstanceConfigMap = {
        [personalId]: {
          driver: codexDriverKind,
          displayName: "Codex (personal)",
          enabled: false,
          config: makeCodexConfig({
            binaryPath: "/opt/codex-personal/bin/codex",
            homePath: "/home/julius/.codex_personal",
            customModels: ["personal-preview"],
          }),
        },
        [workId]: {
          driver: codexDriverKind,
          displayName: "Codex (work)",
          enabled: false,
          config: makeCodexConfig({
            binaryPath: "/opt/codex-work/bin/codex",
            homePath: "/home/julius/.codex",
            customModels: ["work-preview"],
          }),
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [CodexDriver],
        configMap,
      });

      const instances = yield* registry.listInstances;
      expect(instances.map((instance) => instance.instanceId).toSorted()).toEqual(
        [personalId, workId].toSorted(),
      );
      expect(instances.every((instance) => instance.driverKind === codexDriverKind)).toBe(true);
      expect(instances.map((instance) => instance.displayName).toSorted()).toEqual(
        ["Codex (personal)", "Codex (work)"].toSorted(),
      );

      // Each instance must be retrievable by id and carry its *own* closures.
      const personal = yield* registry.getInstance(personalId);
      const work = yield* registry.getInstance(workId);
      expect(personal).toBeDefined();
      expect(work).toBeDefined();
      expect(personal!.adapter).not.toBe(work!.adapter);
      expect(personal!.textGeneration).not.toBe(work!.textGeneration);
      expect(personal!.snapshot).not.toBe(work!.snapshot);

      // Snapshots identify themselves by instanceId + driver — this is
      // what makes per-instance routing distinguishable downstream.
      const personalSnapshot = yield* personal!.snapshot.getSnapshot;
      expect(personalSnapshot.instanceId).toBe(personalId);
      expect(personalSnapshot.driver).toBe(codexDriverKind);
      expect(personalSnapshot.enabled).toBe(false);
      expect(posixHomeGroupKey(personalSnapshot.continuation?.groupKey)).toBe(
        "codex:home:/home/julius/.codex_personal",
      );

      const workSnapshot = yield* work!.snapshot.getSnapshot;
      expect(workSnapshot.instanceId).toBe(workId);
      expect(workSnapshot.driver).toBe(codexDriverKind);
      expect(workSnapshot.enabled).toBe(false);
      expect(posixHomeGroupKey(workSnapshot.continuation?.groupKey)).toBe(
        "codex:home:/home/julius/.codex",
      );

      // Nothing goes to the unavailable bucket — both drivers are registered.
      const unavailable = yield* registry.listUnavailable;
      expect(unavailable).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live(
    "shadows instances whose driver is not registered in this build without failing boot",
    () =>
      Effect.gen(function* () {
        const codexId = ProviderInstanceId.make("codex_main");
        const ghostId = ProviderInstanceId.make("ghost_main");

        const configMap: ProviderInstanceConfigMap = {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            enabled: false,
            config: makeCodexConfig({}),
          },
          [ghostId]: {
            driver: ProviderDriverKind.make("ghostDriver"),
            displayName: "A fork-only driver we don't ship",
            enabled: false,
            config: { arbitrary: "payload", preserved: true },
          },
        };

        const { registry } = yield* makeProviderInstanceRegistry({
          drivers: [CodexDriver],
          configMap,
        });

        const instances = yield* registry.listInstances;
        expect(instances).toHaveLength(1);
        expect(instances[0]!.instanceId).toBe(codexId);

        const unavailable = yield* registry.listUnavailable;
        expect(unavailable).toHaveLength(1);
        const ghost = unavailable[0]!;
        expect(ghost.instanceId).toBe(ghostId);
        expect(ghost.driver).toBe("ghostDriver");
        expect(ghost.availability).toBe("unavailable");
        expect(ghost.unavailableReason).toMatch(/ghostDriver/);
      }).pipe(Effect.provide(testLayer)),
  );
});

describe("ProviderInstanceRegistryLive — all drivers slice", () => {
  // All drivers need `NodeServices` (ChildProcessSpawner + FileSystem +
  // Path). `OpenCodeDriver.create` additionally yields `OpenCodeRuntime`
  // at construction time, so we wire `OpenCodeRuntimeLive` into the stack.
  // `OpenCodeRuntimeLive` bundles its own `NetService.layer` via
  // `Layer.provide`, so the only external requirement it still exposes is
  // `ChildProcessSpawner` — resolved here by piping it through
  // `provideMerge(NodeServices.layer)`.
  //
  // The nested `provideMerge`s read bottom-up: `NodeServices.layer`
  // provides `OpenCodeRuntimeLive`'s deps while keeping its own outputs
  // surfaced; that merged layer then provides `ServerConfig.layerTest`'s
  // `FileSystem` dep while keeping everything else surfaced to the test.
  const infraLayer = OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer));
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "provider-instance-registry-all-drivers-test",
  }).pipe(
    Layer.provideMerge(infraLayer),
    Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(TestHttpClientLive),
    Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  );

  it.live("boots one instance of every shipped driver from a single config map", () =>
    Effect.gen(function* () {
      const codexId = ProviderInstanceId.make("codex_default");
      const claudeId = ProviderInstanceId.make("claude_default");
      const cursorId = ProviderInstanceId.make("cursor_default");
      const grokId = ProviderInstanceId.make("grok_default");
      const openCodeId = ProviderInstanceId.make("opencode_default");

      const codexDriverKind = ProviderDriverKind.make("codex");
      const claudeDriverKind = ProviderDriverKind.make("claudeAgent");
      const cursorDriverKind = ProviderDriverKind.make("cursor");
      const grokDriverKind = ProviderDriverKind.make("grok");
      const openCodeDriverKind = ProviderDriverKind.make("opencode");

      const configMap: ProviderInstanceConfigMap = {
        [codexId]: {
          driver: codexDriverKind,
          displayName: "Codex",
          enabled: false,
          config: makeCodexConfig({ homePath: "/home/julius/.codex" }),
        },
        [claudeId]: {
          driver: claudeDriverKind,
          displayName: "Claude",
          enabled: false,
          config: makeClaudeConfig({
            homePath: "/home/julius/.claude-work",
            launchArgs: "--verbose",
          }),
        },
        [cursorId]: {
          driver: cursorDriverKind,
          displayName: "Cursor",
          enabled: false,
          config: makeCursorConfig({}),
        },
        [grokId]: {
          driver: grokDriverKind,
          displayName: "Grok",
          enabled: false,
          config: makeGrokConfig({}),
        },
        [openCodeId]: {
          driver: openCodeDriverKind,
          displayName: "OpenCode",
          enabled: false,
          config: makeOpenCodeConfig({}),
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [CodexDriver, ClaudeDriver, CursorDriver, GrokDriver, OpenCodeDriver],
        configMap,
      });

      // Every configured instance must materialize — none downgraded to a
      // shadow snapshot, because every driver in the map is registered.
      const unavailable = yield* registry.listUnavailable;
      expect(unavailable).toEqual([]);

      const instances = yield* registry.listInstances;
      expect(instances).toHaveLength(5);
      expect(instances.map((instance) => instance.instanceId).toSorted()).toEqual(
        [codexId, claudeId, cursorId, grokId, openCodeId].toSorted(),
      );

      // Instance lookup by id resolves each instance to its own bundle —
      // this is how rest-of-server routes turn/session calls in the new
      // model. Each driver's bundle carries its advertised `driverKind`.
      const codex = yield* registry.getInstance(codexId);
      const claude = yield* registry.getInstance(claudeId);
      const cursor = yield* registry.getInstance(cursorId);
      const grok = yield* registry.getInstance(grokId);
      const openCode = yield* registry.getInstance(openCodeId);
      expect(codex?.driverKind).toBe(codexDriverKind);
      expect(claude?.driverKind).toBe(claudeDriverKind);
      expect(cursor?.driverKind).toBe(cursorDriverKind);
      expect(grok?.driverKind).toBe(grokDriverKind);
      expect(openCode?.driverKind).toBe(openCodeDriverKind);
      expect(codex?.displayName).toBe("Codex");
      expect(claude?.displayName).toBe("Claude");
      expect(cursor?.displayName).toBe("Cursor");
      expect(grok?.displayName).toBe("Grok");
      expect(openCode?.displayName).toBe("OpenCode");

      // Every instance owns its own set of closures — no sharing across
      // drivers. `adapter` / `textGeneration` / `snapshot` are all
      // distinct references even when two instances happen to share a
      // trait (e.g. Cursor + others all use a stub-or-real
      // `textGeneration`; they must still be different object values).
      const adapters = [
        codex!.adapter,
        claude!.adapter,
        cursor!.adapter,
        grok!.adapter,
        openCode!.adapter,
      ];
      expect(new Set(adapters).size).toBe(adapters.length);
      const textGenerations = [
        codex!.textGeneration,
        claude!.textGeneration,
        cursor!.textGeneration,
        grok!.textGeneration,
        openCode!.textGeneration,
      ];
      expect(new Set(textGenerations).size).toBe(textGenerations.length);
      const snapshots = [
        codex!.snapshot,
        claude!.snapshot,
        cursor!.snapshot,
        grok!.snapshot,
        openCode!.snapshot,
      ];
      expect(new Set(snapshots).size).toBe(snapshots.length);

      // Snapshots identify themselves by `instanceId` + `driver` so
      // downstream aggregation in `ProviderRegistry` can tell instances
      // apart even when two share a driver. With `enabled: false`, the
      // check short-circuits and we get a disabled/pending snapshot back
      // — that's enough signal to validate the stamping wrapper without
      // spawning real binaries.
      const codexSnapshot = yield* codex!.snapshot.getSnapshot;
      expect(codexSnapshot.instanceId).toBe(codexId);
      expect(codexSnapshot.driver).toBe(codexDriverKind);
      expect(codexSnapshot.enabled).toBe(false);
      expect(posixHomeGroupKey(codexSnapshot.continuation?.groupKey)).toBe(
        "codex:home:/home/julius/.codex",
      );

      const claudeSnapshot = yield* claude!.snapshot.getSnapshot;
      expect(claudeSnapshot.instanceId).toBe(claudeId);
      expect(claudeSnapshot.driver).toBe(claudeDriverKind);
      expect(claudeSnapshot.enabled).toBe(false);
      expect(posixHomeGroupKey(claudeSnapshot.continuation?.groupKey)).toBe(
        "claude:home:/home/julius/.claude-work",
      );

      const cursorSnapshot = yield* cursor!.snapshot.getSnapshot;
      expect(cursorSnapshot.instanceId).toBe(cursorId);
      expect(cursorSnapshot.driver).toBe(cursorDriverKind);
      expect(cursorSnapshot.enabled).toBe(false);
      expect(cursorSnapshot.continuation?.groupKey).toBe(
        `${cursorDriverKind}:instance:${cursorId}`,
      );

      const grokSnapshot = yield* grok!.snapshot.getSnapshot;
      expect(grokSnapshot.instanceId).toBe(grokId);
      expect(grokSnapshot.driver).toBe(grokDriverKind);
      expect(grokSnapshot.enabled).toBe(false);
      expect(grokSnapshot.continuation?.groupKey).toBe(`${grokDriverKind}:instance:${grokId}`);

      const openCodeSnapshot = yield* openCode!.snapshot.getSnapshot;
      expect(openCodeSnapshot.instanceId).toBe(openCodeId);
      expect(openCodeSnapshot.driver).toBe(openCodeDriverKind);
      expect(openCodeSnapshot.enabled).toBe(false);
      expect(openCodeSnapshot.continuation?.groupKey).toBe(
        `${openCodeDriverKind}:instance:${openCodeId}`,
      );
    }).pipe(Effect.provide(testLayer)),
  );
});

describe("ProviderInstanceRegistryLive — endpoint and auth profiles", () => {
  const OMNIROUTER_ENDPOINT_ID = EndpointProfileId.make("omnirouter_prod");
  const OMNIROUTER_AUTH_ID = AuthProfileId.make("omnirouter_kevin");
  const MISSING_ENDPOINT_ID = EndpointProfileId.make("missing_endpoint");
  const fakeDriverKind = ProviderDriverKind.make("codex");

  const makeRecordingDriver = (created: ProviderDriverCreateInput<unknown>[]) =>
    ({
      driverKind: fakeDriverKind,
      metadata: { displayName: "Recording" },
      configSchema: Schema.Unknown,
      defaultConfig: () => ({}),
      create: (input) => {
        created.push(input);
        return Effect.succeed({
          instanceId: input.instanceId,
          driverKind: fakeDriverKind,
          continuationIdentity: defaultProviderContinuationIdentity({
            driverKind: fakeDriverKind,
            instanceId: input.instanceId,
          }),
          displayName: input.displayName,
          enabled: input.enabled,
          snapshot: {
            maintenanceCapabilities: makeManualOnlyProviderMaintenanceCapabilities({
              provider: fakeDriverKind,
              packageName: null,
            }),
            getSnapshot: Effect.succeed({
              instanceId: input.instanceId,
              driver: fakeDriverKind,
              enabled: input.enabled,
              installed: false,
              version: null,
              status: "disabled",
              auth: { status: "unknown" },
              checkedAt: "1970-01-01T00:00:00.000Z",
              models: [],
              slashCommands: [],
              skills: [],
            } satisfies ServerProvider),
            refresh: Effect.succeed({} as ServerProvider),
            streamChanges: Stream.empty,
          },
          adapter: {} as ProviderInstance["adapter"],
          textGeneration: {} as ProviderInstance["textGeneration"],
          auth: makeCodexProviderAuth({
            instanceId: input.instanceId,
            processEnv: {},
            ...(input.connection !== undefined ? { connection: input.connection } : {}),
          }),
        } satisfies ProviderInstance);
      },
    }) satisfies ProviderDriver<unknown>;

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

  it.live("passes a resolved connection into driver.create when both ids are set", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex_omnirouter");
      const created: ProviderDriverCreateInput<unknown>[] = [];
      const configMap: ProviderInstanceConfigMap = {
        [instanceId]: {
          driver: fakeDriverKind,
          enabled: false,
          endpointProfileId: OMNIROUTER_ENDPOINT_ID,
          authProfileId: OMNIROUTER_AUTH_ID,
          config: {},
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [makeRecordingDriver(created)],
        configMap,
      });

      expect(created).toHaveLength(1);
      expect(created[0]?.connection?.endpoint?.id).toBe(OMNIROUTER_ENDPOINT_ID);
      expect(created[0]?.connection?.endpoint?.baseUrl).toBe("https://router.example/v1");
      expect(created[0]?.connection?.auth?.id).toBe(OMNIROUTER_AUTH_ID);
      expect(created[0]?.connection?.auth?.secret).toBe("tok_live");
      expect(created[0]?.environment).toEqual([
        { name: "OMNIROUTER_TOKEN", value: "tok_live", sensitive: true },
      ]);

      const instances = yield* registry.listInstances;
      expect(instances).toHaveLength(1);
      expect(yield* registry.listUnavailable).toEqual([]);
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "provider-instance-registry-connection-test",
        }).pipe(
          Layer.provideMerge(NodeServices.layer),
          Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
          Layer.provideMerge(
            ServerSettingsService.layerTest({
              endpointProfiles: {
                [OMNIROUTER_ENDPOINT_ID]: {
                  name: "OmniRouter",
                  baseUrl: "https://router.example/v1",
                  protocol: "openai-responses",
                  modelDiscovery: { type: "models-endpoint" },
                },
              },
              authProfiles: {
                [OMNIROUTER_AUTH_ID]: {
                  name: "Kevin OmniRouter",
                  method: "bearer-env",
                  envKey: "OMNIROUTER_TOKEN",
                  secretRedacted: true,
                },
              },
            }),
          ),
          Layer.provideMerge(
            memorySecretStoreLayer({
              [authProfileSecretName(OMNIROUTER_AUTH_ID)]: "tok_live",
            }),
          ),
          Layer.provideMerge(TestHttpClientLive),
          Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
        ),
      ),
    ),
  );

  it.live("keeps the instance available and warns when endpointProfileId is dangling", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex_dangling");
      const created: ProviderDriverCreateInput<unknown>[] = [];
      const configMap: ProviderInstanceConfigMap = {
        [instanceId]: {
          driver: fakeDriverKind,
          enabled: false,
          endpointProfileId: MISSING_ENDPOINT_ID,
          config: {},
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [makeRecordingDriver(created)],
        configMap,
      });

      expect(created).toHaveLength(1);
      expect(created[0]?.connection?.endpoint).toBeUndefined();
      expect(yield* registry.listUnavailable).toEqual([]);

      const instance = yield* registry.getInstance(instanceId);
      expect(instance).toBeDefined();
      const snapshot = yield* instance!.snapshot.getSnapshot;
      expect(snapshot.message).toBeDefined();
      expect(snapshot.message).toContain("Endpoint profile");
      expect(snapshot.message).toContain(MISSING_ENDPOINT_ID);
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "provider-instance-registry-dangling-test",
        }).pipe(
          Layer.provideMerge(NodeServices.layer),
          Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
          Layer.provideMerge(ServerSettingsService.layerTest()),
          Layer.provideMerge(memorySecretStoreLayer({})),
          Layer.provideMerge(TestHttpClientLive),
          Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
        ),
      ),
    ),
  );

  it.live("rebuilds the instance without the auth env after providerAuth logout", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex_omnirouter");
      const created: ProviderDriverCreateInput<unknown>[] = [];
      const serverSettings = yield* ServerSettingsService;
      yield* serverSettings.updateSettings({
        endpointProfiles: {
          [OMNIROUTER_ENDPOINT_ID]: {
            name: "OmniRouter",
            baseUrl: "https://router.example/v1",
            protocol: "openai-responses",
            modelDiscovery: { type: "models-endpoint" },
          },
        },
        authProfiles: {
          [OMNIROUTER_AUTH_ID]: {
            name: "Kevin OmniRouter",
            method: "bearer-env",
            envKey: "OMNIROUTER_TOKEN",
          },
        },
        authProfileSecrets: {
          [OMNIROUTER_AUTH_ID]: "tok_live",
        },
      });

      const configMap: ProviderInstanceConfigMap = {
        [instanceId]: {
          driver: fakeDriverKind,
          enabled: false,
          endpointProfileId: OMNIROUTER_ENDPOINT_ID,
          authProfileId: OMNIROUTER_AUTH_ID,
          config: {},
        },
      };

      const { registry, mutator } = yield* makeProviderInstanceRegistry({
        drivers: [makeRecordingDriver(created)],
        configMap,
      });

      expect(created).toHaveLength(1);
      expect(created[0]?.connection?.auth?.secret).toBe("tok_live");
      expect(created[0]?.environment).toEqual([
        { name: "OMNIROUTER_TOKEN", value: "tok_live", sensitive: true },
      ]);

      yield* Effect.gen(function* () {
        const auth = yield* ProviderAuth;
        yield* auth.logout({ instanceId });
      }).pipe(
        Effect.provide(
          ProviderAuthLive.pipe(Layer.provide(Layer.succeed(ProviderInstanceRegistry, registry))),
        ),
      );

      const settings = yield* serverSettings.getSettings;
      const connection = yield* resolveProviderConnection(settings, configMap[instanceId]!);
      expect(connection.auth?.secret).toBeUndefined();
      expect(settings.authProfiles[OMNIROUTER_AUTH_ID]?.secretRedacted).toBeUndefined();

      yield* mutator.reconcile(configMap);
      expect(created).toHaveLength(2);
      expect(created[1]?.connection?.auth?.secret).toBeUndefined();
      expect(created[1]?.environment).toEqual([]);

      yield* mutator.reconcile(configMap);
      expect(created).toHaveLength(2);
    }).pipe(
      Effect.provide(
        serverSettingsLayer.pipe(
          Layer.provideMerge(ServerSecretStore.layer),
          Layer.provideMerge(
            Layer.fresh(
              ServerConfig.layerTest(process.cwd(), {
                prefix: "provider-instance-registry-logout-rebuild-test",
              }),
            ),
          ),
          Layer.provideMerge(NodeServices.layer),
          Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
          Layer.provideMerge(TestHttpClientLive),
          Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
        ),
      ),
    ),
  );
});
