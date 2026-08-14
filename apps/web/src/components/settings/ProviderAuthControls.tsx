"use client";

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { CopyIcon, LoaderIcon } from "lucide-react";
import { useCallback, useContext, useState } from "react";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { providerAuth } from "../../state/providerAuth";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { toProviderAuthControlsModel } from "./ProviderAuthControls.logic";

function commandFailureMessage(cause: Cause.Cause<unknown>): string {
  const squashed = Cause.squash(cause);
  if (
    squashed !== null &&
    typeof squashed === "object" &&
    "message" in squashed &&
    typeof squashed.message === "string" &&
    squashed.message.trim().length > 0
  ) {
    return squashed.message;
  }
  return "Provider sign-in failed";
}

export function ProviderAuthControls(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
}) {
  const registry = useContext(RegistryContext);
  const statusAtom = providerAuth.getStatus({
    environmentId: props.environmentId,
    input: { instanceId: props.instanceId },
  });
  const statusResult = useAtomValue(statusAtom);
  const status = Option.getOrUndefined(AsyncResult.value(statusResult));
  const model = toProviderAuthControlsModel(status);
  const pendingFlowId = status?.state === "pending" ? status.flowId : undefined;
  const begin = useAtomCommand(providerAuth.begin, { reportFailure: false });
  const cancel = useAtomCommand(providerAuth.cancel, { reportFailure: false });
  const logout = useAtomCommand(providerAuth.logout, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | undefined>(undefined);
  const { copyToClipboard } = useCopyToClipboard<{ userCode: string }>({
    onCopy: () => {
      toastManager.add({
        type: "success",
        title: "User code copied",
      });
    },
    onError: () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy user code",
        }),
      );
    },
  });

  const run = useCallback(
    async (
      work: () => Promise<{ readonly _tag: string; readonly cause?: Cause.Cause<unknown> }>,
    ) => {
      setBusy(true);
      setCommandError(undefined);
      try {
        const result = await work();
        registry.refresh(statusAtom);
        if (result._tag === "Failure" && result.cause !== undefined) {
          setCommandError(commandFailureMessage(result.cause));
        }
      } finally {
        setBusy(false);
      }
    },
    [registry, statusAtom],
  );

  if (model.deviceCode) {
    const panel = model.deviceCode;
    return (
      <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
        <p className="text-[13px] text-muted-foreground">
          Open{" "}
          <a
            href={panel.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {panel.verificationUri}
          </a>{" "}
          and enter
        </p>
        <div className="flex min-w-0 items-center gap-1">
          <code className="rounded bg-background px-2 py-1 font-mono text-sm tracking-[0.18em] text-foreground">
            {panel.userCode}
          </code>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`Copy user code ${panel.userCode}`}
            onClick={() => void copyToClipboard(panel.userCode, { userCode: panel.userCode })}
          >
            <CopyIcon className="size-3" />
          </Button>
          {model.canCancel ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  cancel({
                    environmentId: props.environmentId,
                    input: { flowId: pendingFlowId! },
                  }),
                )
              }
            >
              {busy ? <LoaderIcon className="animate-spin" /> : null}
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (model.browser) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <span>{model.browser.message}</span>
        {model.canCancel && pendingFlowId ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() =>
                cancel({
                  environmentId: props.environmentId,
                  input: { flowId: pendingFlowId },
                }),
              )
            }
          >
            Cancel
          </Button>
        ) : null}
      </div>
    );
  }

  if (model.error || commandError) {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-destructive">{commandError ?? model.error}</p>
        {model.canSignIn ? (
          <div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  begin({
                    environmentId: props.environmentId,
                    input: {
                      instanceId: props.instanceId,
                      ...(model.signInMethod !== undefined ? { method: model.signInMethod } : {}),
                    },
                  }),
                )
              }
            >
              {busy ? <LoaderIcon className="animate-spin" /> : null}
              Sign in
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (!model.canSignIn && !model.canSignOut) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {model.canSignIn ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(() =>
              begin({
                environmentId: props.environmentId,
                input: {
                  instanceId: props.instanceId,
                  ...(model.signInMethod !== undefined ? { method: model.signInMethod } : {}),
                },
              }),
            )
          }
        >
          {busy ? <LoaderIcon className="animate-spin" /> : null}
          Sign in
        </Button>
      ) : null}
      {model.canSignOut ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(() =>
              logout({
                environmentId: props.environmentId,
                input: { instanceId: props.instanceId },
              }),
            )
          }
        >
          {busy ? <LoaderIcon className="animate-spin" /> : null}
          Sign out
        </Button>
      ) : null}
    </div>
  );
}
