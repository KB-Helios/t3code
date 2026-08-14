/**
 * Translate a resolved endpoint/auth connection into Codex's native
 * `config.toml` `model_provider` tables.
 *
 * The managed block is rewritten on every reconcile. Unrelated user keys
 * (`approval_policy`, `[mcp_servers]`, other `[model_providers.*]`) stay put.
 * Secret material never enters this file — only the env var *name*.
 *
 * @module provider/endpoint/codexEndpointConfig
 */
import type { AuthProfileMethod, EndpointProfileId, EndpointProtocol } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { CodexHomeLayout } from "../Drivers/CodexHomeLayout.ts";
import type { ResolvedProviderConnection } from "./resolveProviderConnection.ts";

export const CODEX_ENDPOINT_MANAGED_COMMENT = "# managed-by: northbridge-endpoint-profile";

export function northbridgeCodexProviderSlug(endpointId: EndpointProfileId): string {
  return `northbridge_${endpointId}`;
}

export function wireApiForEndpointProtocol(protocol: EndpointProtocol): "responses" | "chat" {
  return protocol === "openai-chat" ? "chat" : "responses";
}

export function shouldWriteCodexEnvKey(method: AuthProfileMethod | undefined): boolean {
  return method === "bearer-env" || method === "api-key-env";
}

export class CodexEndpointConfigFileSystemError extends Schema.TaggedErrorClass<CodexEndpointConfigFileSystemError>()(
  "CodexEndpointConfigFileSystemError",
  {
    path: Schema.String,
    operation: Schema.Literals(["readFile", "writeFile"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Codex endpoint config filesystem operation '${this.operation}' failed for '${this.path}'.`;
  }
}

function escapeTomlBasicString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, (char) => {
      const code = char.charCodeAt(0);
      return `\\u${code.toString(16).padStart(4, "0")}`;
    });
}

function isTableHeader(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function isTopLevelModelProviderAssignment(line: string): boolean {
  return /^model_provider\s*=/.test(line.trim());
}

function isNorthbridgeProviderTable(line: string): boolean {
  return /^\[model_providers\.northbridge_[^\]]+\]$/.test(line.trim());
}

function normalizeTomlBlankLines(toml: string): string {
  return toml
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function stripManagedCodexEndpointTables(toml: string): string {
  const lines = toml.split(/\r?\n/);
  const kept: string[] = [];
  let inTable = false;
  let inManagedTable = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const trimmed = line.trim();

    if (isTableHeader(line)) {
      if (isNorthbridgeProviderTable(line)) {
        inManagedTable = true;
        index += 1;
        while (index < lines.length) {
          const next = lines[index]!;
          if (isTableHeader(next)) {
            break;
          }
          index += 1;
        }
        inManagedTable = false;
        continue;
      }
      inTable = true;
      inManagedTable = false;
      kept.push(line);
      index += 1;
      continue;
    }

    if (trimmed === CODEX_ENDPOINT_MANAGED_COMMENT) {
      if (!inTable) {
        index += 1;
        continue;
      }
      kept.push(line);
      index += 1;
      continue;
    }

    if (!inTable && isTopLevelModelProviderAssignment(line)) {
      index += 1;
      continue;
    }

    kept.push(line);
    index += 1;
  }

  return normalizeTomlBlankLines(kept.join("\n"));
}

function splitPreambleAndTables(toml: string): {
  readonly preamble: string;
  readonly tables: string;
} {
  const lines = toml.length === 0 ? [] : toml.split(/\r?\n/);
  const firstTable = lines.findIndex((line) => isTableHeader(line));
  if (firstTable === -1) {
    return { preamble: toml, tables: "" };
  }
  return {
    preamble: normalizeTomlBlankLines(lines.slice(0, firstTable).join("\n")),
    tables: normalizeTomlBlankLines(lines.slice(firstTable).join("\n")),
  };
}

function renderManagedSelector(slug: string): string {
  return `${CODEX_ENDPOINT_MANAGED_COMMENT}\nmodel_provider = "${slug}"`;
}

function renderManagedProviderTable(connection: ResolvedProviderConnection): string {
  const endpoint = connection.endpoint;
  if (endpoint === undefined) return "";
  const slug = northbridgeCodexProviderSlug(endpoint.id);
  const lines = [
    CODEX_ENDPOINT_MANAGED_COMMENT,
    `[model_providers.${slug}]`,
    `name = "${escapeTomlBasicString(endpoint.name)}"`,
    `base_url = "${escapeTomlBasicString(endpoint.baseUrl)}"`,
    `wire_api = "${wireApiForEndpointProtocol(endpoint.protocol)}"`,
  ];
  const auth = connection.auth;
  if (shouldWriteCodexEnvKey(auth?.method) && auth.envKey !== undefined) {
    lines.push(`env_key = "${escapeTomlBasicString(auth.envKey)}"`);
  }
  return lines.join("\n");
}

export function upsertCodexEndpointToml(
  existingToml: string,
  connection: ResolvedProviderConnection,
): string {
  if (connection.endpoint === undefined) {
    return existingToml;
  }
  const slug = northbridgeCodexProviderSlug(connection.endpoint.id);
  const { preamble, tables } = splitPreambleAndTables(
    stripManagedCodexEndpointTables(existingToml),
  );
  const parts = [
    preamble,
    renderManagedSelector(slug),
    tables,
    renderManagedProviderTable(connection),
  ].filter((part) => part.length > 0);
  return `${parts.join("\n\n")}\n`;
}

export const applyCodexEndpointConfig = Effect.fn("applyCodexEndpointConfig")(function* (
  layout: CodexHomeLayout,
  connection: ResolvedProviderConnection,
): Effect.fn.Return<void, CodexEndpointConfigFileSystemError, FileSystem.FileSystem | Path.Path> {
  if (connection.endpoint === undefined || !layout.privateConfigToml) {
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
        return new CodexEndpointConfigFileSystemError({
          path: configPath,
          operation: "readFile",
          cause,
        });
      },
    }),
  );

  const next = upsertCodexEndpointToml(existing, connection);
  yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true }).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        new CodexEndpointConfigFileSystemError({
          path: configPath,
          operation: "writeFile",
          cause,
        }),
    }),
  );

  const tempPath = path.join(path.dirname(configPath), `.config.toml.tmp.${Date.now()}`);
  yield* fileSystem.writeFileString(tempPath, next).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        new CodexEndpointConfigFileSystemError({
          path: tempPath,
          operation: "writeFile",
          cause,
        }),
    }),
  );

  yield* fileSystem.rename(tempPath, configPath).pipe(
    Effect.catchTags({
      PlatformError: (cause) => {
        fileSystem.remove(tempPath).pipe(Effect.orDie, Effect.runPromise);
        return new CodexEndpointConfigFileSystemError({
          path: configPath,
          operation: "writeFile",
          cause,
        });
      },
    }),
  );
});
