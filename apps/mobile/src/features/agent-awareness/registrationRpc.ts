import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  AgentAwarenessRegistrationInput,
  AgentAwarenessRegistrationResult,
  AgentAwarenessUnregistrationInput,
  EnvironmentId,
} from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { loadOrCreateAgentAwarenessDeviceId } from "../../persistence/imperative";
import { appAtomRegistry } from "../../state/atom-registry";

const registerCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "agent-awareness:register",
  execute: (request: { environmentId: EnvironmentId; input: AgentAwarenessRegistrationInput }) =>
    EnvironmentRegistry.pipe(
      Effect.flatMap((registry) =>
        registry.run(
          request.environmentId,
          Effect.gen(function* () {
            const supervisor = yield* EnvironmentSupervisor;
            const session = yield* SubscriptionRef.get(supervisor.session);
            if (Option.isNone(session)) {
              return yield* Effect.fail(
                new Error(`Environment ${request.environmentId} is not connected.`),
              );
            }
            return yield* session.value.client[WS_METHODS.agentAwarenessRegister](request.input);
          }),
        ),
      ),
    ),
});

const unregisterCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "agent-awareness:unregister",
  execute: (request: { environmentId: EnvironmentId; input: AgentAwarenessUnregistrationInput }) =>
    EnvironmentRegistry.pipe(
      Effect.flatMap((registry) =>
        registry.run(
          request.environmentId,
          Effect.gen(function* () {
            const supervisor = yield* EnvironmentSupervisor;
            const session = yield* SubscriptionRef.get(supervisor.session);
            if (Option.isNone(session)) {
              return yield* Effect.fail(
                new Error(`Environment ${request.environmentId} is not connected.`),
              );
            }
            return yield* session.value.client[WS_METHODS.agentAwarenessUnregister](request.input);
          }),
        ),
      ),
    ),
});

async function runRegistrationCommand(
  command: typeof registerCommand | typeof unregisterCommand,
  request: {
    environmentId: EnvironmentId;
    input: AgentAwarenessRegistrationInput | AgentAwarenessUnregistrationInput;
  },
): Promise<AgentAwarenessRegistrationResult> {
  const result = await command.run(appAtomRegistry, request as never);
  if (AsyncResult.isSuccess(result)) return result.value;
  throw Cause.squash(result.cause);
}

export const registerAgentAwarenessEnvironment = (
  environmentId: EnvironmentId,
  input: AgentAwarenessRegistrationInput,
) => runRegistrationCommand(registerCommand, { environmentId, input });

export const unregisterAgentAwarenessEnvironment = (
  environmentId: EnvironmentId,
  input: AgentAwarenessUnregistrationInput,
) => runRegistrationCommand(unregisterCommand, { environmentId, input });

export async function unregisterAgentAwarenessEnvironmentBeforeRemoval(
  environmentId: EnvironmentId,
): Promise<void> {
  const installationId = await loadOrCreateAgentAwarenessDeviceId();
  await unregisterAgentAwarenessEnvironment(environmentId, { installationId });
}
