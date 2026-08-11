import { afterEach, assert, describe, expect, it, vi } from "vite-plus/test";

const loadConfig = async (env: Record<string, string | undefined> = {}) => {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value ?? "");
  }
  return (await import("./app.config.ts")).default;
};

const pluginOptions = (config: Awaited<ReturnType<typeof loadConfig>>, name: string) => {
  const plugin = config.plugins?.find((entry) => Array.isArray(entry) && entry[0] === name);
  if (!Array.isArray(plugin)) throw new Error(`Missing Expo plugin: ${name}`);
  return plugin[1] as Record<string, unknown>;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("NorthBridgeCode Expo config", () => {
  it("uses the production public identity and no previous-owner metadata", async () => {
    const config = await loadConfig({ APP_VARIANT: "production" });

    assert.equal(config.name, "NorthBridgeCode");
    assert.equal(config.slug, "northbridgecode");
    assert.deepEqual(config.scheme, ["northbridgecode", "t3code"]);
    assert.equal(config.ios?.bundleIdentifier, "com.kbhelios.northbridgecode");
    assert.equal(config.android?.package, "com.kbhelios.northbridgecode");
    assert.notProperty(config, "owner");
    assert.notProperty(config.ios ?? {}, "appleTeamId");
    assert.notProperty(config.updates ?? {}, "url");
    assert.notNestedProperty(config, "extra.eas.projectId");

    assert.deepInclude(pluginOptions(config, "expo-widgets"), {
      bundleIdentifier: "com.kbhelios.northbridgecode.widgets",
      groupIdentifier: "group.com.kbhelios.northbridgecode",
      enablePushNotifications: true,
    });
    const sharing = pluginOptions(config, "expo-sharing").ios as Record<string, unknown>;
    assert.equal(sharing.enabled, true);
    assert.equal(sharing.extensionBundleIdentifier, "com.kbhelios.northbridgecode.sharing");
    assert.equal(sharing.appGroupId, "group.com.kbhelios.northbridgecode");
  });

  it("uses a side-by-side NorthBridgeCode development identity", async () => {
    const config = await loadConfig({ APP_VARIANT: "development" });

    assert.equal(config.name, "NorthBridgeCode (Dev)");
    assert.deepEqual(config.scheme, ["northbridgecode-dev", "t3code-dev"]);
    assert.equal(config.ios?.bundleIdentifier, "com.kbhelios.northbridgecode.dev");
    assert.equal(config.android?.package, "com.kbhelios.northbridgecode.dev");
    assert.deepInclude(pluginOptions(config, "expo-widgets"), {
      bundleIdentifier: "com.kbhelios.northbridgecode.dev.widgets",
      groupIdentifier: "group.com.kbhelios.northbridgecode.dev",
    });
  });

  it("accepts explicit KB-Helios distribution metadata", async () => {
    const config = await loadConfig({
      APP_VARIANT: "production",
      NORTHBRIDGECODE_APPLE_TEAM_ID: "ABC1234567",
      NORTHBRIDGECODE_EXPO_OWNER: "kb-helios",
      NORTHBRIDGECODE_EXPO_PROJECT_ID: "11111111-2222-4333-8444-555555555555",
      NORTHBRIDGECODE_EXPO_UPDATES_URL: "https://u.expo.dev/11111111-2222-4333-8444-555555555555",
    });

    assert.equal(config.owner, "kb-helios");
    assert.equal(config.ios?.appleTeamId, "ABC1234567");
    assert.equal(config.updates?.url, "https://u.expo.dev/11111111-2222-4333-8444-555555555555");
    assert.nestedPropertyVal(config, "extra.eas.projectId", "11111111-2222-4333-8444-555555555555");
  });

  it("fails a distribution build clearly when owned metadata is missing", async () => {
    await expect(
      loadConfig({ APP_VARIANT: "production", NORTHBRIDGECODE_DISTRIBUTION_BUILD: "1" }),
    ).rejects.toThrow(
      /NORTHBRIDGECODE_APPLE_TEAM_ID.*NORTHBRIDGECODE_EXPO_OWNER.*NORTHBRIDGECODE_EXPO_PROJECT_ID.*NORTHBRIDGECODE_EXPO_UPDATES_URL/s,
    );
  });
});
