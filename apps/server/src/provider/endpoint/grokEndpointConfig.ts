/**
 * Translate a resolved endpoint/auth connection into Grok's native
 * `config.toml` `[model.*]` table.
 *
 * The managed block is rewritten on every reconcile. Unrelated user keys
 * stay put. Secret material never enters this file — only the env var *name*.
 *
 * @module provider/endpoint/grokEndpointConfig
 */
import type { AuthProfileMethod, EndpointProfileId, EndpointProtocol } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { GrokHomeLayout } from "../Drivers/GrokHome.ts";
import type { ResolvedProviderConnection } from "./resolveProviderConnection.ts";

export const GROK_ENDPOINT_MANAGED_COMMENT = "# managed-by: northbridge-endpoint-profile";

export function northbridgeGrokModelTable(endpointId: EndpointProfileId): string {
  return `northbridge_${endpointId}`;
}

export function apiBackendForEndpointProtocol(protocol: EndpointProtocol): "responses" | "chat" {
  return protocol === "openai-chat" ? "chat" : "responses";
}

export function shouldWriteGrokEnvKey(method: AuthProfileMethod | undefined): boolean {
  return method === "bearer-env" || method === "api-key-env";
}

export class GrokEndpointConfigFileSystemError extends Schema.TaggedErrorClass<GrokEndpointConfigFileSystemError>()(
  "GrokEndpointConfigFileSystemError",
  {
    path: Schema.String,
    operation: Schema.Literals(["readFile", "writeFile"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Grok endpoint config filesystem operation '${this.operation}' failed for '${this.path}'.`;
  }
}

function escapeTomlBasicString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isTableHeader(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function isNorthbridgeModelTable(line: string): boolean {
  return /^\[model\.northbridge_[^\]]+\]$/.test(line.trim());
}

function normalizeTomlBlankLines(toml: string): string {
  return toml
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function stripManagedGrokEndpointTables(toml: string): string {
  const lines = toml.split(/\r?\n/);
  const kept: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const trimmed = line.trim();

    if (trimmed === GROK_ENDPOINT_MANAGED_COMMENT) {
      index += 1;
      continue;
    }

    if (isTableHeader(line) && isNorthbridgeModelTable(line)) {
      index += 1;
      while (index < lines.length) {
        const next = lines[index]!;
        if (next.trim() === GROK_ENDPOINT_MANAGED_COMMENT || isTableHeader(next)) {
          break;
        }
        index += 1;
      }
      continue;
    }

    kept.push(line);
    index += 1;
  }

  return normalizeTomlBlankLines(kept.join("\n"));
}

function renderManagedModelTable(connection: ResolvedProviderConnection): string {
  const endpoint = connection.endpoint;
  if (endpoint === undefined) return "";
  const slug = northbridgeGrokModelTable(endpoint.id);
  const lines = [
    GROK_ENDPOINT_MANAGED_COMMENT,
    `[model.${slug}]`,
    `model = "default"`,
    `base_url = "${escapeTomlBasicString(endpoint.baseUrl)}"`,
  ];
  const auth = connection.auth;
  if (shouldWriteGrokEnvKey(auth?.method) && auth.envKey !== undefined) {
    lines.push(`env_key = "${escapeTomlBasicString(auth.envKey)}"`);
  }
  lines.push(`api_backend = "${apiBackendForEndpointProtocol(endpoint.protocol)}"`);
  return lines.join("\n");
}

export function upsertGrokEndpointToml(
  existingToml: string,
  connection: ResolvedProviderConnection,
): string {
  if (connection.endpoint === undefined) {
    return existingToml;
  }
  const stripped = stripManagedGrokEndpointTables(existingToml);
  const table = renderManagedModelTable(connection);
  const parts = [stripped, table].filter((part) => part.length > 0);
  return `${parts.join("\n\n")}\n`;
}

export const applyGrokEndpointConfig = Effect.fn("applyGrokEndpointConfig")(function* (
  layout: GrokHomeLayout,
  connection: ResolvedProviderConnection,
): Effect.fn.Return<void, GrokEndpointConfigFileSystemError, FileSystem.FileSystem | Path.Path> {
  if (connection.endpoint === undefined || !layout.isolated) {
    return;
  }
  const effectiveHomePath = layout.effectiveHomePath;
  if (effectiveHomePath === undefined) {
    return;
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configPath = path.join(effectiveHomePath, "config.toml");

  const existing = yield* fileSystem.readFileString(configPath).pipe(
    Effect.catchTags({
      PlatformError: (cause) => {
        if (cause.reason._tag === "NotFound") {
          return Effect.succeed("");
        }
        return new GrokEndpointConfigFileSystemError({
          path: configPath,
          operation: "readFile",
          cause,
        });
      },
    }),
  );

  const next = upsertGrokEndpointToml(existing, connection);
  yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true }).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        new GrokEndpointConfigFileSystemError({
          path: configPath,
          operation: "writeFile",
          cause,
        }),
    }),
  );
  yield* fileSystem.writeFileString(configPath, next).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        new GrokEndpointConfigFileSystemError({
          path: configPath,
          operation: "writeFile",
          cause,
        }),
    }),
  );
});
