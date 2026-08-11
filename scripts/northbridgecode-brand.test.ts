import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "vitest";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";
import { readPngDimensions } from "./lib/icon-export.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const read = (path: string) => NodeFS.readFileSync(NodePath.join(root, path), "utf8");
const readBytes = (path: string) => NodeFS.readFileSync(NodePath.join(root, path));
const gitBlobDigest = (contents: Buffer) =>
  NodeCrypto.createHash("sha1").update(`blob ${contents.length}\0`).update(contents).digest("hex");

describe("NorthBridgeCode public branding", () => {
  it("publishes the new mobile schemes while retaining legacy deep links", () => {
    const app = read("apps/mobile/src/App.tsx");
    assert.include(app, '"northbridgecode://"');
    assert.include(app, '"northbridgecode-dev://"');
    assert.include(app, '"t3code://"');

    const expoConfig = read("apps/mobile/app.config.ts");
    assert.include(expoConfig, 'schemes: ["northbridgecode", "t3code"]');

    const activity = read("apps/mobile/src/widgets/AgentActivity.tsx");
    assert.include(activity, "`northbridgecode://${deepLinkRow.deepLink.slice(1)}`");
    assert.include(activity, 'assetName="NBMark"');
    assert.notInclude(activity, 'assetName="T3Mark"');
  });

  it("ships NorthBridgeCode web, mobile, server, and release metadata", () => {
    assert.include(read("apps/web/index.html"), "<title>NorthBridgeCode</title>");
    assert.match(
      read("apps/mobile/src/components/BrandMark.tsx"),
      />\s*NorthBridgeCode\s*<\/Text>/,
    );

    const serverPackage = JSON.parse(read("apps/server/package.json")) as {
      readonly description: string;
      readonly repository: { readonly url: string };
      readonly bin: Record<string, string>;
    };
    assert.equal(serverPackage.description, "NorthBridgeCode self-hosted server and CLI.");
    assert.equal(serverPackage.repository.url, "https://github.com/KB-Helios/t3code");
    assert.equal(serverPackage.bin.northbridgecode, "./dist/bin.mjs");
    assert.equal(serverPackage.bin.t3, "./dist/bin.mjs");
    assert.include(read("apps/server/src/bin.ts"), "Run the NorthBridgeCode server.");
    assert.include(read(".github/workflows/release.yml"), "name=NorthBridgeCode v$version");
    assert.notInclude(read("scripts/mobile-showcase.ts"), "T3Code.xcworkspace");
    assert.notInclude(read("apps/mobile/scripts/wire-widget-asset-catalog.cjs"), "T3CodeDev");
  });

  it("uses an NB mark in every public icon source", () => {
    for (const path of [
      "assets/prod/app-icon.icon/Assets/text.svg",
      "assets/dev/app-icon.icon/Assets/text.svg",
      "assets/nightly/app-icon.icon/Assets/text.svg",
      "apps/mobile/assets/widget/NBMark.svg",
    ]) {
      const svg = read(path);
      assert.include(svg, 'data-brand="NorthBridgeCode"');
      assert.notInclude(svg, "M33.4509 93");
    }
    for (const path of [
      "apps/web/src/components/sidebar/SidebarChrome.tsx",
      "apps/mobile/src/components/T3Wordmark.tsx",
      "scripts/mobile-showcase-environment.ts",
    ]) {
      const publicMark = read(path);
      assert.include(publicMark, "M12 94V34L54 94V34");
      assert.notInclude(publicMark, "M33.4509 93");
    }
  });

  it("replaces every former public T3 raster with valid PNG and ICO assets", () => {
    const legacyBlobHashes = {
      "assets/prod/black-ios-1024.png": "bfc80410aadc53a4fd7fb3de76d4e8a5b6d66509",
      "assets/prod/t3-black-windows.ico": "5fac0d8b24ea6b08fa3db0ddf20b112c06c49048",
      "assets/prod/t3-black-web-favicon.ico": "5fac0d8b24ea6b08fa3db0ddf20b112c06c49048",
      "assets/prod/t3-black-web-apple-touch-180.png": "327a8ac55fafa3d27860e4f902ea72a705bb8326",
      "assets/dev/blueprint-ios-1024.png": "a53c8d19aa83afbe7b7e468aaebe9a56642dcc76",
      "assets/dev/blueprint-windows.ico": "750da22602eecab3f8cc8ffae34d6b4a0396084a",
      "assets/dev/blueprint-web-favicon.ico": "750da22602eecab3f8cc8ffae34d6b4a0396084a",
      "assets/dev/blueprint-web-apple-touch-180.png": "3eed25ea6b7850fc2594ac509e91c29f1710f708",
      "assets/nightly/nightly-ios-1024.png": "42ce5589e9cacd365348b27ae3d05be390ef0348",
      "assets/nightly/nightly-windows.ico": "b6a0b43b93d2ea1f6df95145bdfe92d6c912b24f",
      "assets/nightly/nightly-web-favicon.ico": "b6a0b43b93d2ea1f6df95145bdfe92d6c912b24f",
      "assets/nightly/nightly-web-apple-touch-180.png": "f09a169458ab49d043f88db07e4e05642bfb5012",
      "apps/web/public/favicon.ico": "750da22602eecab3f8cc8ffae34d6b4a0396084a",
      "apps/web/public/apple-touch-icon.png": "3eed25ea6b7850fc2594ac509e91c29f1710f708",
    } as const;
    for (const [path, legacyHash] of Object.entries(legacyBlobHashes)) {
      assert.notEqual(gitBlobDigest(readBytes(path)), legacyHash, path);
    }

    for (const path of [
      ...Object.values(BRAND_ASSET_PATHS).filter((path) => path.endsWith(".png")),
      "apps/web/public/favicon-16x16.png",
      "apps/web/public/favicon-32x32.png",
      "apps/web/public/apple-touch-icon.png",
    ]) {
      const expectedSize = path.includes("16x16")
        ? 16
        : path.includes("32x32")
          ? 32
          : path.includes("apple-touch")
            ? 180
            : 1024;
      assert.deepEqual(readPngDimensions(readBytes(path)), {
        width: expectedSize,
        height: expectedSize,
      });
    }
    for (const path of [
      ...Object.values(BRAND_ASSET_PATHS).filter((path) => path.endsWith(".ico")),
      "apps/web/public/favicon.ico",
    ]) {
      const ico = readBytes(path);
      assert.equal(ico.readUInt16LE(0), 0, path);
      assert.equal(ico.readUInt16LE(2), 1, path);
      assert.isAbove(ico.readUInt16LE(4), 0, path);
    }
  });

  it("ships fully opaque iOS app icons", () => {
    for (const path of [
      BRAND_ASSET_PATHS.developmentIosIconPng,
      BRAND_ASSET_PATHS.nightlyIosIconPng,
      BRAND_ASSET_PATHS.productionIosIconPng,
    ]) {
      const png = readBytes(path);
      assert.equal(png[24], 8, `${path} must use 8-bit channels`);
      assert.equal(png[25], 2, `${path} must be RGB without an alpha channel`);
      assert.notInclude(png.toString("latin1"), "tRNS", `${path} must not declare transparency`);
    }
  });

  it("does not embed the previous Expo owner or signing metadata", () => {
    const mobileConfig = read("apps/mobile/app.config.ts");
    const easConfig = read("apps/mobile/eas.json");
    assert.notInclude(mobileConfig, "pingdotgg");
    assert.notInclude(mobileConfig, "ARK85ZXQ4Z");
    assert.notInclude(mobileConfig, "d763fcb8-d37c-41ea-a773-b54a0ab4a454");
    assert.notInclude(easConfig, '"ascAppId"');
  });

  it("preserves the functional t3.json schema compatibility endpoint", () => {
    const projectSchema = read("packages/contracts/src/t3ProjectFile.ts");
    assert.include(projectSchema, '"https://t3.codes/schema/t3.json"');
    assert.notInclude(projectSchema, "github.com/KB-Helios/t3code#t3.json");
  });
});
