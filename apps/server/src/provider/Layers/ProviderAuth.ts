/**
 * Interactive provider-auth facade + in-memory device-code flow registry.
 *
 * Tokens never enter serialized `ProviderAuthState`. Cancel kills only the
 * PID captured at spawn.
 *
 * @module provider/Layers/ProviderAuth
 */
import {
  ProviderAuthError,
  ProviderAuthFlowId,
  type ProviderAuthBeginInput,
  type ProviderAuthFlowInput,
  type ProviderAuthInstanceInput,
  type ProviderAuthMethod,
  type ProviderAuthState,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  authProfileSecretName,
  type ResolvedProviderConnection,
} from "../endpoint/resolveProviderConnection.ts";
import type { ProviderDriverAuth } from "../ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";

const DEVICE_CODE_TTL = Duration.minutes(15);
const DEVICE_CODE_PARSE_TIMEOUT = Duration.seconds(20);
const CODEX_BROWSER_MESSAGE = "Finish Codex login on the environment host";
const GROK_API_KEY_ENV = "XAI_API_KEY";

const DEVICE_URL_PATTERN = /https?:\/\/[^\s]+/i;
const DEVICE_USER_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;
const DEVICE_ENTER_CODE_PATTERN = /enter(?:\s+(?:the\s+)?)?code[:\s]+([A-Z0-9-]+)/i;

export interface GrokAuthConfig {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath: string;
  readonly processEnv: NodeJS.ProcessEnv;
  readonly connection?: ResolvedProviderConnection;
}

export interface CodexAuthConfig {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath?: string;
  readonly processEnv: NodeJS.ProcessEnv;
  readonly connection?: ResolvedProviderConnection;
  readonly getSnapshot?: () => Effect.Effect<{
    readonly auth: {
      readonly status: "authenticated" | "unauthenticated" | "unknown";
      readonly email?: string;
      readonly label?: string;
    };
  }>;
}

interface RegisteredFlow {
  readonly flowId: ProviderAuthFlowId;
  readonly instanceId: ProviderInstanceId;
  readonly pid: number | undefined;
  readonly kill: () => Effect.Effect<void>;
  cancelled: boolean;
  state: ProviderAuthState;
}

interface ProviderAuthShape {
  readonly getStatus: (
    input: ProviderAuthInstanceInput,
  ) => Effect.Effect<ProviderAuthState, ProviderAuthError>;
  readonly begin: (
    input: ProviderAuthBeginInput,
  ) => Effect.Effect<ProviderAuthState, ProviderAuthError>;
  readonly getFlow: (
    input: ProviderAuthFlowInput,
  ) => Effect.Effect<ProviderAuthState, ProviderAuthError>;
  readonly cancel: (
    input: ProviderAuthFlowInput,
  ) => Effect.Effect<ProviderAuthState, ProviderAuthError>;
  readonly logout: (input: ProviderAuthInstanceInput) => Effect.Effect<void, ProviderAuthError>;
}

export class ProviderAuth extends Context.Service<ProviderAuth, ProviderAuthShape>()(
  "t3/provider/Layers/ProviderAuth",
) {}

const grokAuthConfigs = new WeakMap<ProviderDriverAuth, GrokAuthConfig>();
const codexAuthConfigs = new WeakMap<ProviderDriverAuth, CodexAuthConfig>();

export function parseGrokDeviceAuthOutput(
  stdout: string,
): { readonly verificationUri: string; readonly userCode: string } | undefined {
  const urlMatch = stdout.match(DEVICE_URL_PATTERN);
  const enterMatch = stdout.match(DEVICE_ENTER_CODE_PATTERN);
  const dashedMatch = stdout.match(DEVICE_USER_CODE_PATTERN);
  const verificationUri = urlMatch?.[0]?.replace(/[.,;]+$/, "");
  const userCode = (enterMatch?.[1] ?? dashedMatch?.[1])?.trim();
  if (!verificationUri || !userCode) return undefined;
  return { verificationUri, userCode };
}

function newFlowId(): ProviderAuthFlowId {
  return ProviderAuthFlowId.make(globalThis.crypto.randomUUID());
}

function isApiKeyAuthMethod(method: string | undefined): boolean {
  return method === "api-key-env" || method === "bearer-env";
}

function envHasKey(env: NodeJS.ProcessEnv, key: string | undefined): boolean {
  if (!key) return false;
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

function grokStatusFromConfig(input: GrokAuthConfig): ProviderAuthState {
  const methods: ProviderAuthMethod[] = ["device-code"];
  const auth = input.connection?.auth;
  const hasApiKey =
    envHasKey(input.processEnv, GROK_API_KEY_ENV) ||
    (isApiKeyAuthMethod(auth?.method) &&
      ((auth?.secret !== undefined && auth.secret.length > 0) ||
        envHasKey(input.processEnv, auth?.envKey)));
  if (hasApiKey) {
    methods.unshift("api-key");
    return { state: "authenticated", methods };
  }
  return { state: "unauthenticated", methods };
}

function codexStatusFromConfig(input: CodexAuthConfig): ProviderAuthState {
  const auth = input.connection?.auth;
  if (isApiKeyAuthMethod(auth?.method)) {
    const present =
      (auth?.secret !== undefined && auth.secret.length > 0) ||
      envHasKey(input.processEnv, auth?.envKey);
    return present
      ? { state: "authenticated", methods: ["api-key"] }
      : { state: "unauthenticated", methods: ["api-key"] };
  }
  return { state: "unauthenticated", methods: ["browser"] };
}

export function makeGrokProviderAuth(input: GrokAuthConfig): ProviderDriverAuth {
  const auth: ProviderDriverAuth = {
    getStatus: () => Effect.succeed(grokStatusFromConfig(input)),
    begin: (method) =>
      Effect.fail(
        new ProviderAuthError({
          message:
            method !== undefined && method !== "device-code"
              ? `Grok does not support ${method} login`
              : "Grok device-code login is started through providerAuth.begin",
          instanceId: input.instanceId,
        }),
      ),
    logout: () => Effect.void,
  };
  grokAuthConfigs.set(auth, input);
  return auth;
}

export function makeCodexProviderAuth(input: CodexAuthConfig): ProviderDriverAuth {
  const auth: ProviderDriverAuth = {
    getStatus: () =>
      Effect.gen(function* () {
        const fromConfig = codexStatusFromConfig(input);
        if (fromConfig.state === "authenticated" || fromConfig.methods[0] === "api-key") {
          return fromConfig;
        }
        if (input.getSnapshot !== undefined) {
          const snapshot = yield* input.getSnapshot();
          if (snapshot.auth.status === "authenticated") {
            const account = snapshot.auth.email ?? snapshot.auth.label;
            return account !== undefined && account.trim().length > 0
              ? { state: "authenticated" as const, account, methods: ["browser" as const] }
              : { state: "authenticated" as const, methods: ["browser" as const] };
          }
        }
        return fromConfig;
      }),
    begin: (method) =>
      Effect.fail(
        new ProviderAuthError({
          message:
            method === "device-code"
              ? "Codex does not support device-code login"
              : "Codex login is started through providerAuth.begin",
          instanceId: input.instanceId,
        }),
      ),
    logout: () => Effect.void,
  };
  codexAuthConfigs.set(auth, input);
  return auth;
}

function snapshotAuthState(snapshot: {
  readonly auth: {
    readonly status: "authenticated" | "unauthenticated" | "unknown";
    readonly email?: string;
    readonly label?: string;
  };
}): ProviderAuthState {
  if (snapshot.auth.status === "authenticated") {
    const account = snapshot.auth.email ?? snapshot.auth.label;
    return account !== undefined && account.trim().length > 0
      ? { state: "authenticated", account }
      : { state: "authenticated" };
  }
  return { state: "unauthenticated", methods: [] };
}

function isExpired(state: ProviderAuthState, nowIso: string): boolean {
  return state.state === "pending" && state.method === "device-code" && state.expiresAt <= nowIso;
}

const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const serverSettings = yield* ServerSettingsService;
  const flowsRef = yield* Ref.make(new Map<string, RegisteredFlow>());

  const readFlows = Ref.get(flowsRef);
  const writeFlows = (next: Map<string, RegisteredFlow>) => Ref.set(flowsRef, next);

  const getRegistered = (flowId: string) =>
    readFlows.pipe(Effect.map((flows) => flows.get(flowId)));

  const flowForInstance = (instanceId: ProviderInstanceId) =>
    readFlows.pipe(
      Effect.map((flows) => {
        for (const flow of flows.values()) {
          if (flow.instanceId === instanceId && !flow.cancelled) return flow;
        }
        return undefined;
      }),
    );

  const putFlow = (flow: RegisteredFlow) =>
    Ref.update(flowsRef, (flows) => {
      const next = new Map(flows);
      next.set(String(flow.flowId), flow);
      return next;
    });

  const updateFlow = (flowId: string, patch: Partial<RegisteredFlow>) =>
    Ref.update(flowsRef, (flows) => {
      const current = flows.get(flowId);
      if (current === undefined) return flows;
      const next = new Map(flows);
      next.set(flowId, { ...current, ...patch });
      return next;
    });

  const killTracked = (flow: RegisteredFlow) =>
    flow.kill().pipe(
      Effect.catch(() => Effect.void),
      Effect.asVoid,
    );

  const retireInstanceFlows = (instanceId: ProviderInstanceId) =>
    Ref.modify(flowsRef, (flows) => {
      const next = new Map(flows);
      const retiring: RegisteredFlow[] = [];
      for (const [id, flow] of flows) {
        if (flow.instanceId === instanceId) {
          retiring.push(flow);
          next.delete(id);
        }
      }
      return [retiring, next];
    }).pipe(
      Effect.flatMap((retiring) =>
        Effect.forEach(retiring, killTracked, { discard: true }),
      ),
    );

  const requireInstance = (instanceId: ProviderInstanceId) =>
    registry.getInstance(instanceId).pipe(
      Effect.flatMap((instance) =>
        instance === undefined
          ? Effect.fail(
              new ProviderAuthError({
                message: `No provider instance bound to id '${instanceId}'`,
                instanceId,
              }),
            )
          : Effect.succeed(instance),
      ),
    );

  const collectDeviceCode = (stdout: Stream.Stream<Uint8Array>) => {
    const decoder = new TextDecoder();
    return stdout.pipe(
      Stream.mapAccum("", (buffer, chunk) => {
        const next = `${buffer}${decoder.decode(chunk)}`;
        const parsed = parseGrokDeviceAuthOutput(next);
        return [next, parsed === undefined ? [] : [parsed]] as const;
      }),
      Stream.filter((chunk) => chunk.length > 0),
      Stream.take(1),
      Stream.runHead,
    );
  };

  const startGrokDeviceLogin = (input: GrokAuthConfig) =>
    Effect.gen(function* () {
      const child = yield* spawner
        .spawn(
          ChildProcess.make(input.binaryPath || "grok", ["login", "--device-auth"], {
            env: input.processEnv,
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAuthError({
                message: "Failed to start Grok device-code login",
                instanceId: input.instanceId,
                cause,
              }),
          ),
        );
      const pid = Number(child.pid);
      const parsed = yield* collectDeviceCode(child.stdout).pipe(
        Effect.timeoutOption(DEVICE_CODE_PARSE_TIMEOUT),
        Effect.map(Option.flatten),
        Effect.mapError(
          (cause) =>
            new ProviderAuthError({
              message: "Failed to read Grok device-code output",
              instanceId: input.instanceId,
              cause,
            }),
        ),
      );
      if (Option.isNone(parsed)) {
        yield* child.kill().pipe(Effect.catch(() => Effect.void));
        return yield* new ProviderAuthError({
          message: "Grok CLI did not print a device verification URL and user code",
          instanceId: input.instanceId,
        });
      }
      const device = parsed.value;
      const now = yield* DateTime.now;
      const flowId = newFlowId();
      const state: ProviderAuthState = {
        state: "pending",
        method: "device-code",
        flowId,
        verificationUri: device.verificationUri,
        userCode: device.userCode,
        expiresAt: DateTime.formatIso(
          DateTime.add(now, { milliseconds: Duration.toMillis(DEVICE_CODE_TTL) }),
        ),
      };
      const flow: RegisteredFlow = {
        flowId,
        instanceId: input.instanceId,
        pid,
        cancelled: false,
        state,
        kill: () => child.kill().pipe(Effect.asVoid),
      };
      yield* putFlow(flow);
      yield* child.exitCode.pipe(
        Effect.matchCauseEffect({
          onFailure: () =>
            getRegistered(String(flowId)).pipe(
              Effect.flatMap((current) =>
                current === undefined || current.cancelled
                  ? Effect.void
                  : updateFlow(String(flowId), {
                      state: { state: "error", message: "Grok login process failed" },
                    }),
              ),
            ),
          onSuccess: (code) =>
            getRegistered(String(flowId)).pipe(
              Effect.flatMap((current) => {
                if (current === undefined || current.cancelled) return Effect.void;
                return Number(code) === 0
                  ? updateFlow(String(flowId), {
                      state: { state: "authenticated", methods: ["device-code"] },
                    })
                  : updateFlow(String(flowId), {
                      state: {
                        state: "error",
                        message: `Grok login exited with code ${Number(code)}`,
                      },
                    });
              }),
            ),
        }),
        Effect.forkDetach,
      );
      return state;
    });

  const startCodexBrowserLogin = (input: CodexAuthConfig) =>
    Effect.gen(function* () {
      const flowId = newFlowId();
      const state: ProviderAuthState = {
        state: "pending",
        method: "browser",
        flowId,
        message: CODEX_BROWSER_MESSAGE,
      };
      const child = yield* spawner
        .spawn(
          ChildProcess.make(input.binaryPath || "codex", ["login"], {
            env: input.processEnv,
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAuthError({
                message: "Failed to start Codex login",
                instanceId: input.instanceId,
                cause,
              }),
          ),
        );
      const pid = Number(child.pid);
      const kill = () => child.kill().pipe(Effect.asVoid);
      yield* putFlow({
        flowId,
        instanceId: input.instanceId,
        pid,
        kill,
        cancelled: false,
        state,
      });
      yield* child.exitCode.pipe(
        Effect.matchCauseEffect({
          onFailure: () =>
            getRegistered(String(flowId)).pipe(
              Effect.flatMap((current) =>
                current === undefined || current.cancelled
                  ? Effect.void
                  : updateFlow(String(flowId), {
                      state: { state: "error", message: "Codex login process failed" },
                    }),
              ),
            ),
          onSuccess: (code) =>
            getRegistered(String(flowId)).pipe(
              Effect.flatMap((current) => {
                if (current === undefined || current.cancelled) return Effect.void;
                return Number(code) === 0
                  ? updateFlow(String(flowId), {
                      state: { state: "authenticated", methods: ["browser"] },
                    })
                  : updateFlow(String(flowId), {
                      state: {
                        state: "error",
                        message: `Codex login exited with code ${Number(code)}`,
                      },
                    });
              }),
            ),
        }),
        Effect.forkDetach,
      );
      return state;
    });

  const deleteAuthProfileSecret = (connection: ResolvedProviderConnection | undefined) => {
    const authId = connection?.auth?.id;
    if (authId === undefined) return Effect.void;
    return secretStore.remove(authProfileSecretName(authId)).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAuthError({
            message: "Failed to remove the auth-profile secret",
            cause,
          }),
      ),
    );
  };

  const persistClearedAuthProfile = (
    authId: NonNullable<ResolvedProviderConnection["auth"]>["id"],
  ) =>
    serverSettings
      .updateSettings({
        authProfileSecrets: { [authId]: "" },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAuthError({
              message: "Failed to persist the cleared auth-profile secret",
              cause,
            }),
        ),
        Effect.asVoid,
      );

  const authProfileSecretPresent = (
    authId: NonNullable<ResolvedProviderConnection["auth"]>["id"],
  ) =>
    secretStore.get(authProfileSecretName(authId)).pipe(
      Effect.map((value) => Option.isSome(value) && value.value.byteLength > 0),
      Effect.catch(() => Effect.succeed(false)),
    );

  const apiKeyStatusFromStore = (
    connection: ResolvedProviderConnection | undefined,
    extraMethods: ReadonlyArray<ProviderAuthMethod>,
  ) =>
    Effect.gen(function* () {
      const auth = connection?.auth;
      if (!isApiKeyAuthMethod(auth?.method) || auth.id === undefined) return undefined;
      const present = yield* authProfileSecretPresent(auth.id);
      const methods: ProviderAuthMethod[] = present
        ? ["api-key", ...extraMethods]
        : [...extraMethods, "api-key"];
      return present
        ? ({ state: "authenticated", methods } satisfies ProviderAuthState)
        : ({ state: "unauthenticated", methods } satisfies ProviderAuthState);
    });

  const getStatus: ProviderAuthShape["getStatus"] = (input) =>
    Effect.gen(function* () {
      const instance = yield* requireInstance(input.instanceId);
      const nowIso = DateTime.formatIso(yield* DateTime.now);
      const flow = yield* flowForInstance(input.instanceId);
      if (
        flow !== undefined &&
        !isExpired(flow.state, nowIso) &&
        (flow.state.state === "pending" ||
          flow.state.state === "error" ||
          flow.state.state === "authenticated")
      ) {
        return flow.state;
      }
      const grok = instance.auth !== undefined ? grokAuthConfigs.get(instance.auth) : undefined;
      const codex = instance.auth !== undefined ? codexAuthConfigs.get(instance.auth) : undefined;
      const fromStore = yield* apiKeyStatusFromStore(
        grok?.connection ?? codex?.connection,
        grok !== undefined ? ["device-code"] : [],
      );
      if (fromStore !== undefined) return fromStore;
      if (instance.auth !== undefined) {
        return yield* instance.auth.getStatus();
      }
      const snapshot = yield* instance.snapshot.getSnapshot;
      return snapshotAuthState(snapshot);
    });

  const begin: ProviderAuthShape["begin"] = (input) =>
    Effect.gen(function* () {
      const instance = yield* requireInstance(input.instanceId);
      yield* retireInstanceFlows(input.instanceId);
      const grok = instance.auth !== undefined ? grokAuthConfigs.get(instance.auth) : undefined;
      if (grok !== undefined) {
        const method = input.method ?? "device-code";
        if (method !== "device-code") {
          return yield* new ProviderAuthError({
            message: `Grok does not support ${method} login`,
            instanceId: input.instanceId,
          });
        }
        return yield* startGrokDeviceLogin(grok);
      }
      const codex = instance.auth !== undefined ? codexAuthConfigs.get(instance.auth) : undefined;
      if (codex !== undefined) {
        const method =
          input.method ??
          (isApiKeyAuthMethod(codex.connection?.auth?.method) ? "api-key" : "browser");
        if (method === "api-key") {
          return yield* new ProviderAuthError({
            message: "Codex API-key auth does not use an interactive login",
            instanceId: input.instanceId,
          });
        }
        if (method === "device-code") {
          return yield* new ProviderAuthError({
            message: "Codex does not support device-code login",
            instanceId: input.instanceId,
          });
        }
        if (method === "browser") {
          return yield* startCodexBrowserLogin(codex);
        }
      }
      if (instance.auth !== undefined) {
        return yield* instance.auth.begin(input.method);
      }
      return yield* new ProviderAuthError({
        message: "Interactive login is not available for this provider",
        instanceId: input.instanceId,
      });
    });

  const getFlow: ProviderAuthShape["getFlow"] = (input) =>
    Effect.gen(function* () {
      const flow = yield* getRegistered(String(input.flowId));
      if (flow === undefined) {
        return yield* new ProviderAuthError({
          message: `Unknown provider auth flow '${input.flowId}'`,
          flowId: input.flowId,
        });
      }
      const nowIso = DateTime.formatIso(yield* DateTime.now);
      if (isExpired(flow.state, nowIso)) {
        const expired: ProviderAuthState = { state: "error", message: "Device-code login expired" };
        yield* updateFlow(String(flow.flowId), { state: expired });
        return expired;
      }
      return flow.state;
    });

  const cancel: ProviderAuthShape["cancel"] = (input) =>
    Effect.gen(function* () {
      const flow = yield* getRegistered(String(input.flowId));
      if (flow === undefined) {
        return yield* new ProviderAuthError({
          message: `Unknown provider auth flow '${input.flowId}'`,
          flowId: input.flowId,
        });
      }
      yield* killTracked(flow);
      yield* updateFlow(String(flow.flowId), { cancelled: true });
      const status = yield* getStatus({ instanceId: flow.instanceId });
      if (
        status.state === "authenticated" ||
        status.state === "error" ||
        status.state === "unauthenticated"
      ) {
        yield* updateFlow(String(flow.flowId), { cancelled: true, state: status });
        return status;
      }
      const instance = yield* requireInstance(flow.instanceId);
      const grok = instance.auth !== undefined ? grokAuthConfigs.get(instance.auth) : undefined;
      const fallbackMethods: ProviderAuthMethod[] = grok !== undefined ? ["device-code"] : [];
      const next: ProviderAuthState = { state: "unauthenticated", methods: fallbackMethods };
      yield* updateFlow(String(flow.flowId), { cancelled: true, state: next });
      return next;
    });

  const logout: ProviderAuthShape["logout"] = (input) =>
    Effect.gen(function* () {
      const instance = yield* requireInstance(input.instanceId);
      const grok = instance.auth !== undefined ? grokAuthConfigs.get(instance.auth) : undefined;
      const codex = instance.auth !== undefined ? codexAuthConfigs.get(instance.auth) : undefined;
      const connection = grok?.connection ?? codex?.connection;
      if (isApiKeyAuthMethod(connection?.auth?.method)) {
        yield* deleteAuthProfileSecret(connection);
        if (connection?.auth?.id !== undefined) {
          yield* persistClearedAuthProfile(connection.auth.id);
        }
      } else if (instance.auth !== undefined) {
        yield* instance.auth.logout();
      }
      yield* retireInstanceFlows(input.instanceId);
    });

  return ProviderAuth.of({ getStatus, begin, getFlow, cancel, logout });
});

export const ProviderAuthLive = Layer.effect(ProviderAuth, make);
export const layer = ProviderAuthLive;
