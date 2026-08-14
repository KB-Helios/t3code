import { describe, expect, it } from "@effect/vitest";
import {
  AuthProfileId,
  ProviderAuthError,
  ProviderAuthState,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { authProfileSecretName } from "../endpoint/resolveProviderConnection.ts";
import { defaultProviderContinuationIdentity, type ProviderInstance } from "../ProviderDriver.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import type { ServerProviderShape } from "../Services/ServerProvider.ts";
import {
  makeCodexProviderAuth,
  makeGrokProviderAuth,
  ProviderAuth,
  ProviderAuthLive,
} from "./ProviderAuth.ts";

const encodeState = Schema.encodeUnknownSync(ProviderAuthState);
const grokId = ProviderInstanceId.make("grok");
const codexId = ProviderInstanceId.make("codex");
const grokDriver = ProviderDriverKind.make("grok");
const codexDriver = ProviderDriverKind.make("codex");
const authProfileId = AuthProfileId.make("omnirouter_kevin");
const encoder = new TextEncoder();

function fakeHandle(input: {
  readonly pid: number;
  readonly stdout: string;
  readonly hang?: boolean;
  readonly exitCode?: number;
  readonly exit?: Effect.Effect<ChildProcessSpawner.ExitCode>;
  readonly killed: { value: boolean; pid?: number };
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(input.pid),
    exitCode:
      input.exit ??
      (input.hang
        ? Effect.never
        : Effect.succeed(ChildProcessSpawner.ExitCode(input.exitCode ?? 0))),
    isRunning: Effect.sync(() => !input.killed.value),
    kill: () =>
      Effect.sync(() => {
        input.killed.value = true;
        input.killed.pid = input.pid;
      }),
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(input.stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function stubSnapshot(provider: ServerProvider): ServerProviderShape {
  return {
    maintenanceCapabilities: makeManualOnlyProviderMaintenanceCapabilities({
      provider: provider.driver,
      packageName: null,
    }),
    getSnapshot: Effect.succeed(provider),
    refresh: Effect.succeed(provider),
    streamChanges: Stream.empty,
  };
}

function stubInstance(
  input: Pick<ProviderInstance, "instanceId" | "driverKind" | "auth">,
): ProviderInstance {
  const snapshot: ServerProvider = {
    instanceId: input.instanceId,
    driver: input.driverKind,
    enabled: true,
    installed: true,
    version: null,
    status: "warning",
    auth: { status: "unknown" },
    checkedAt: "2026-08-13T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
  return {
    instanceId: input.instanceId,
    driverKind: input.driverKind,
    continuationIdentity: defaultProviderContinuationIdentity({
      driverKind: input.driverKind,
      instanceId: input.instanceId,
    }),
    displayName: undefined,
    enabled: true,
    snapshot: stubSnapshot(snapshot),
    adapter: {} as ProviderAdapterShape<never>,
    textGeneration: {} as ProviderInstance["textGeneration"],
    ...(input.auth !== undefined ? { auth: input.auth } : {}),
  };
}

function registryLayer(instances: ReadonlyArray<ProviderInstance>) {
  return Layer.succeed(ProviderInstanceRegistry, {
    getInstance: (instanceId) =>
      Effect.succeed(instances.find((instance) => instance.instanceId === instanceId)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.die("unused"),
  });
}

function providerAuthLayer(input: {
  readonly instances: ReadonlyArray<ProviderInstance>;
  readonly spawn: Parameters<typeof ChildProcessSpawner.make>[0];
  readonly secretStore?: ServerSecretStore.ServerSecretStore["Service"];
}) {
  return ProviderAuthLive.pipe(
    Layer.provide(registryLayer(input.instances)),
    Layer.provide(
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(input.spawn)),
    ),
    Layer.provide(
      Layer.succeed(
        ServerSecretStore.ServerSecretStore,
        input.secretStore ??
          ServerSecretStore.ServerSecretStore.of({
            get: () => Effect.succeed(Option.none()),
            set: () => Effect.void,
            create: () => Effect.void,
            getOrCreateRandom: () => Effect.die("unused"),
            remove: () => Effect.void,
          }),
      ),
    ),
  );
}

const grokInstance = stubInstance({
  instanceId: grokId,
  driverKind: grokDriver,
  auth: makeGrokProviderAuth({
    instanceId: grokId,
    binaryPath: "grok",
    processEnv: { GROK_HOME: "/tmp/grok-home" },
  }),
});

describe("ProviderAuth", () => {
  it.effect("Grok begin(device-code) returns verificationUri and userCode from CLI stdout", () =>
    Effect.gen(function* () {
      const auth = yield* ProviderAuth;
      const state = yield* auth.begin({ instanceId: grokId, method: "device-code" });
      expect(state.state).toBe("pending");
      if (state.state === "pending" && state.method === "device-code") {
        expect(state.verificationUri).toBe("https://x.ai/device");
        expect(state.userCode).toBe("ABCD-EFGH");
        expect(state.expiresAt.length).toBeGreaterThan(0);
      }
    }).pipe(
      Effect.provide(
        providerAuthLayer({
          instances: [grokInstance],
          spawn: () =>
            Effect.succeed(
              fakeHandle({
                pid: 4242,
                stdout: "Visit https://x.ai/device and enter ABCD-EFGH",
                hang: true,
                killed: { value: false },
              }),
            ),
        }),
      ),
    ),
  );

  it.effect("does not include a refresh token in any providerAuth payload", () =>
    Effect.gen(function* () {
      const auth = yield* ProviderAuth;
      const state = yield* auth.begin({ instanceId: grokId, method: "device-code" });
      const encoded = encodeState(state);
      const serialized = `${JSON.stringify(encoded)}\n${JSON.stringify(state)}`;
      expect(serialized).not.toContain("xyz");
      expect(serialized).not.toContain("refresh_token");
      expect(state.state).toBe("pending");
      if (state.state === "pending" && state.method === "device-code") {
        expect(state.userCode).toBe("ABCD-EFGH");
        expect(state.verificationUri).toBe("https://x.ai/device");
      }
    }).pipe(
      Effect.provide(
        providerAuthLayer({
          instances: [grokInstance],
          spawn: () =>
            Effect.succeed(
              fakeHandle({
                pid: 7,
                stdout: "Visit https://x.ai/device and enter ABCD-EFGH\nrefresh_token=xyz",
                hang: true,
                killed: { value: false },
              }),
            ),
        }),
      ),
    ),
  );

  it.effect("cancel kills only the tracked login PID", () => {
    const killed = { value: false, pid: undefined as number | undefined };
    return Effect.gen(function* () {
      const auth = yield* ProviderAuth;
      const pending = yield* auth.begin({ instanceId: grokId, method: "device-code" });
      expect(pending.state).toBe("pending");
      if (pending.state !== "pending") return;
      const cancelled = yield* auth.cancel({ flowId: pending.flowId });
      expect(killed.value).toBe(true);
      expect(killed.pid).toBe(9191);
      expect(cancelled.state === "unauthenticated" || cancelled.state === "error").toBe(true);
    }).pipe(
      Effect.provide(
        providerAuthLayer({
          instances: [grokInstance],
          spawn: (command) => {
            const args = "args" in command ? command.args : [];
            const commandName = "command" in command ? String(command.command) : "";
            expect(`${commandName} ${Array.isArray(args) ? args.join(" ") : ""}`).toContain(
              "login --device-auth",
            );
            return Effect.succeed(
              fakeHandle({
                pid: 9191,
                stdout: "Visit https://x.ai/device and enter ABCD-EFGH",
                hang: true,
                killed,
              }),
            );
          },
        }),
      ),
    );
  });

  it.effect("Codex API-key status is authenticated when the auth-profile secret is present", () => {
    const secretName = authProfileSecretName(authProfileId);
    const secrets = new Map<string, Uint8Array>([
      [secretName, encoder.encode("sk-live-not-on-wire")],
    ]);
    const removed: string[] = [];
    const store = ServerSecretStore.ServerSecretStore.of({
      get: (name) =>
        Effect.succeed(secrets.has(name) ? Option.some(secrets.get(name)!) : Option.none()),
      set: () => Effect.void,
      create: () => Effect.void,
      getOrCreateRandom: () => Effect.die("unused"),
      remove: (name) =>
        Effect.sync(() => {
          removed.push(name);
          secrets.delete(name);
        }),
    });
    return Effect.gen(function* () {
      const auth = yield* ProviderAuth;
      const status = yield* auth.getStatus({ instanceId: codexId });
      expect(status).toMatchObject({
        state: "authenticated",
        methods: ["api-key"],
      });
      expect(JSON.stringify(status)).not.toContain("sk-live-not-on-wire");
      yield* auth.logout({ instanceId: codexId });
      expect(removed).toEqual([secretName]);
      const afterLogout = yield* auth.getStatus({ instanceId: codexId });
      expect(afterLogout).toMatchObject({
        state: "unauthenticated",
        methods: ["api-key"],
      });
      expect(JSON.stringify(afterLogout)).not.toContain("sk-live-not-on-wire");
    }).pipe(
      Effect.provide(
        providerAuthLayer({
          instances: [
            stubInstance({
              instanceId: codexId,
              driverKind: codexDriver,
              auth: makeCodexProviderAuth({
                instanceId: codexId,
                processEnv: {},
                connection: {
                  auth: {
                    id: authProfileId,
                    name: "OmniRouter",
                    method: "api-key-env",
                    envKey: "OPENAI_API_KEY",
                    secret: "sk-live-not-on-wire",
                  },
                },
              }),
            }),
          ],
          spawn: () => Effect.die("Codex API-key begin must not spawn"),
          secretStore: store,
        }),
      ),
    );
  });

  const awaitStatus = (
    auth: (typeof ProviderAuth)["Service"],
    instanceId: ProviderInstanceId,
    match: (state: ProviderAuthState) => boolean,
  ) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 32; attempt++) {
        const status = yield* auth.getStatus({ instanceId });
        if (match(status)) return status;
        yield* Effect.yieldNow;
      }
      return yield* auth.getStatus({ instanceId });
    });

  it.effect("begin after a failed Grok login replaces the error flow", () =>
    Effect.gen(function* () {
      const firstExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      let calls = 0;
      yield* Effect.gen(function* () {
        const auth = yield* ProviderAuth;
        const pending = yield* auth.begin({ instanceId: grokId, method: "device-code" });
        expect(pending.state).toBe("pending");
        if (pending.state === "pending" && pending.method === "device-code") {
          expect(pending.userCode).toBe("ABCD-EFGH");
        }
        yield* Deferred.succeed(firstExit, ChildProcessSpawner.ExitCode(1));
        const errored = yield* awaitStatus(auth, grokId, (state) => state.state === "error");
        expect(errored.state).toBe("error");
        const retry = yield* auth.begin({ instanceId: grokId, method: "device-code" });
        expect(retry.state).toBe("pending");
        if (retry.state === "pending" && retry.method === "device-code") {
          expect(retry.userCode).toBe("WXYZ-1234");
        }
        const status = yield* auth.getStatus({ instanceId: grokId });
        expect(status.state).toBe("pending");
        if (status.state === "pending" && status.method === "device-code") {
          expect(status.userCode).toBe("WXYZ-1234");
        }
      }).pipe(
        Effect.provide(
          providerAuthLayer({
            instances: [grokInstance],
            spawn: () => {
              calls += 1;
              return Effect.succeed(
                fakeHandle(
                  calls === 1
                    ? {
                        pid: 11,
                        stdout: "Visit https://x.ai/device and enter ABCD-EFGH",
                        exit: Deferred.await(firstExit),
                        killed: { value: false },
                      }
                    : {
                        pid: 12,
                        stdout: "Visit https://x.ai/device and enter WXYZ-1234",
                        hang: true,
                        killed: { value: false },
                      },
                ),
              );
            },
          }),
        ),
      );
    }),
  );

  it.effect("prefers a completed device-code flow over an empty auth-profile store", () =>
    Effect.gen(function* () {
      const done = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      yield* Effect.gen(function* () {
        const auth = yield* ProviderAuth;
        const pending = yield* auth.begin({ instanceId: grokId, method: "device-code" });
        expect(pending.state).toBe("pending");
        yield* Deferred.succeed(done, ChildProcessSpawner.ExitCode(0));
        const status = yield* awaitStatus(auth, grokId, (state) => state.state === "authenticated");
        expect(status).toMatchObject({
          state: "authenticated",
          methods: ["device-code"],
        });
      }).pipe(
        Effect.provide(
          providerAuthLayer({
            instances: [
              stubInstance({
                instanceId: grokId,
                driverKind: grokDriver,
                auth: makeGrokProviderAuth({
                  instanceId: grokId,
                  binaryPath: "grok",
                  processEnv: { GROK_HOME: "/tmp/grok-home" },
                  connection: {
                    auth: {
                      id: authProfileId,
                      name: "OmniRouter",
                      method: "api-key-env",
                      envKey: "XAI_API_KEY",
                    },
                  },
                }),
              }),
            ],
            spawn: () =>
              Effect.succeed(
                fakeHandle({
                  pid: 33,
                  stdout: "Visit https://x.ai/device and enter ABCD-EFGH",
                  exit: Deferred.await(done),
                  killed: { value: false },
                }),
              ),
          }),
        ),
      );
    }),
  );

  it.effect("Codex begin(browser) fails when spawn fails", () =>
    Effect.gen(function* () {
      const auth = yield* ProviderAuth;
      const result = yield* auth
        .begin({ instanceId: codexId, method: "browser" })
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toBeInstanceOf(ProviderAuthError);
        expect(result.failure.message).toContain("Failed to start Codex login");
      }
      const status = yield* auth.getStatus({ instanceId: codexId });
      expect(status.state).not.toBe("pending");
    }).pipe(
      Effect.provide(
        providerAuthLayer({
          instances: [
            stubInstance({
              instanceId: codexId,
              driverKind: codexDriver,
              auth: makeCodexProviderAuth({
                instanceId: codexId,
                binaryPath: "codex",
                processEnv: {},
              }),
            }),
          ],
          spawn: () =>
            Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "ChildProcess",
                method: "spawn",
                description: "codex",
              }),
            ),
        }),
      ),
    ),
  );
});
