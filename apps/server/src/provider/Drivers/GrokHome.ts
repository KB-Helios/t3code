/**
 * Resolve and isolate a per-instance Grok home.
 *
 * The Grok CLI honors `GROK_HOME` (default `~/.grok`). Endpoint instances
 * get a NorthBridge-owned directory under
 * `<stateDir>/provider-homes/<instanceId>/grok` so a second instance never
 * writes `~/.grok/config.toml`.
 *
 * @module provider/Drivers/GrokHome
 */
import * as NodeOS from "node:os";

import type { GrokSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { expandHomePath } from "../../pathExpansion.ts";

export const GROK_HOME_ENV = "GROK_HOME";

export interface GrokHomeLayout {
  readonly sharedHomePath: string;
  readonly effectiveHomePath: string | undefined;
  readonly isolated: boolean;
}

export interface ResolveGrokHomeOptions {
  readonly instanceId?: string;
  readonly stateDir?: string;
  readonly endpointAttached?: boolean;
}

export class GrokHomeFileSystemError extends Schema.TaggedErrorClass<GrokHomeFileSystemError>()(
  "GrokHomeFileSystemError",
  {
    path: Schema.String,
    operation: Schema.Literals(["makeDirectory"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Grok home filesystem operation '${this.operation}' failed for '${this.path}'.`;
  }
}

export const resolveGrokHomeLayout = Effect.fn("resolveGrokHomeLayout")(function* (
  config: Pick<GrokSettings, "homePath">,
  options?: ResolveGrokHomeOptions,
): Effect.fn.Return<GrokHomeLayout, never, Path.Path> {
  const path = yield* Path.Path;
  const sharedHomePath = path.resolve(path.join(NodeOS.homedir(), ".grok"));
  const configuredHome = config.homePath.trim();
  if (configuredHome.length > 0) {
    const effectiveHomePath = path.resolve(expandHomePath(configuredHome));
    return {
      sharedHomePath,
      effectiveHomePath,
      isolated: effectiveHomePath !== sharedHomePath,
    };
  }
  if (options?.endpointAttached === true) {
    const instanceId = options.instanceId?.trim() ?? "";
    const stateDir = options.stateDir?.trim() ?? "";
    if (instanceId.length > 0 && stateDir.length > 0) {
      return {
        sharedHomePath,
        effectiveHomePath: path.join(stateDir, "provider-homes", instanceId, "grok"),
        isolated: true,
      };
    }
  }
  return {
    sharedHomePath,
    effectiveHomePath: undefined,
    isolated: false,
  };
});

export const makeGrokEnvironment = Effect.fn("makeGrokEnvironment")(function* (
  config: Pick<GrokSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const layout = yield* resolveGrokHomeLayout(config);
  if (layout.effectiveHomePath === undefined) {
    return resolvedBaseEnv;
  }
  return {
    ...resolvedBaseEnv,
    [GROK_HOME_ENV]: layout.effectiveHomePath,
  };
});

export const materializeGrokHome = Effect.fn("materializeGrokHome")(function* (
  layout: GrokHomeLayout,
): Effect.fn.Return<void, GrokHomeFileSystemError, FileSystem.FileSystem> {
  if (!layout.isolated || layout.effectiveHomePath === undefined) {
    return;
  }
  const fileSystem = yield* FileSystem.FileSystem;
  yield* fileSystem.makeDirectory(layout.effectiveHomePath, { recursive: true }).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        new GrokHomeFileSystemError({
          path: layout.effectiveHomePath!,
          operation: "makeDirectory",
          cause,
        }),
    }),
  );
});
