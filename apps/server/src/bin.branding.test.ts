import { assert, it } from "@effect/vitest";

import { makeCli } from "./bin.ts";

it("uses the public NorthBridgeCode CLI identity", () => {
  const cli = makeCli();

  assert.strictEqual(cli.name, "northbridgecode");
  assert.strictEqual(cli.description, "Run the NorthBridgeCode server.");
});
