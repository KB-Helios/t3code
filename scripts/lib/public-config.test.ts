// @effect-diagnostics nodeBuiltinImport:off - Tests exercise Node-native env file loading.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

describe("loadRepoEnv", () => {
  it("merges root, local, and process values in increasing priority", () => {
    const repoRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-config-"));
    try {
      NodeFS.writeFileSync(NodePath.join(repoRoot, ".env"), "ROOT_ONLY=root\nSHARED=root\n");
      NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "LOCAL_ONLY=local\nSHARED=local\n");

      expect(loadRepoEnv({ baseEnv: { SHARED: "process" }, repoRoot })).toMatchObject({
        ROOT_ONLY: "root",
        LOCAL_ONLY: "local",
        SHARED: "process",
      });
    } finally {
      NodeFS.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
