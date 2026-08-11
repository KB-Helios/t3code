# Task 3 report: public NorthBridgeCode identity

Status: DONE_WITH_CONCERNS

## Outcome

- Rebranded the public desktop, mobile, web, CLI, documentation, and release identity to `NorthBridgeCode` / `northbridgecode`.
- Kept internal `@t3tools/*` package names, the published `t3` package name, `T3CODE_*` compatibility inputs, `.t3` state paths, native `T3*` module names, and other non-public identifiers where renaming would risk installed state or native compatibility.
- Preserved the existing Windows desktop feature set and the iOS widget, Live Activity, notification, sharing, navigation, direct pairing, and personal-team build paths.
- Removed Ping-owned Expo owner, project, update URL, Apple team, store, hosted-web, and package-manager defaults. NorthBridgeCode distribution metadata is now operator-owned and explicit.

## Desktop identity and upgrade compatibility

- Public product/app identity is now `NorthBridgeCode`, `com.kbhelios.northbridgecode`, executable `northbridgecode`, Linux WM class `northbridgecode`, and artifacts such as `NorthBridgeCode-${version}-${arch}.${ext}`.
- Windows NSIS explicitly pins the legacy electron-builder upgrade GUID `e9197887-efb3-55e0-985e-d6d3b5dd594a` while exposing the new app ID. This preserves upgrade/uninstall continuity for existing installations instead of deriving a new GUID from the new app ID.
- Public OS deep-link registration advertises the new `northbridgecode://` / `northbridgecode-dev://` schemes and the legacy `t3code://` / `t3code-dev://` aliases. The Linux URL handler registers both families.
- The internal Electron renderer origins remain `t3code://app` and `t3code-dev://app`. This deliberately preserves origin-scoped localStorage and IndexedDB without an unsafe storage migration.
- Desktop userdata resolution checks the existing hidden `t3code` / `t3code-dev` directories, then the older display-name directories `T3 Code (Alpha)` / `T3 Code (Dev)`, before falling back to the new NorthBridgeCode directory.
- Existing updater behavior remains, with public repository/release metadata moved to `KB-Helios/t3code`.

## Mobile identity and iOS preservation

- Expo production identity is `NorthBridgeCode`, slug `northbridgecode`, bundle/package ID `com.kbhelios.northbridgecode`, app group `group.com.kbhelios.northbridgecode`, widget ID `com.kbhelios.northbridgecode.widgets`, and share extension ID `com.kbhelios.northbridgecode.sharing`.
- Development and preview variants retain separate side-by-side identifiers.
- Expo receives variant-specific scheme arrays: production `[northbridgecode, t3code]`, development `[northbridgecode-dev, t3code-dev]`, and preview `[northbridgecode-preview, t3code-preview]`. React Navigation accepts the same new and legacy prefixes, so legacy links can launch a fresh installation as well as route inside a running app.
- Distribution ownership is supplied through `NORTHBRIDGECODE_APPLE_TEAM_ID`, `NORTHBRIDGECODE_EXPO_OWNER`, `NORTHBRIDGECODE_EXPO_PROJECT_ID`, and `NORTHBRIDGECODE_EXPO_UPDATES_URL`. Preview/production EAS profiles set `NORTHBRIDGECODE_DISTRIBUTION_BUILD=1`; missing metadata then fails with a single clear error. Ordinary local Expo config remains valid with updates disabled and no credentials.
- `T3CODE_IOS_PERSONAL_TEAM` and `T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID` remain supported.
- Widget artwork is now `NBMark`, and the widget/share plugin wiring, push entitlements, Live Activity rendering, notification deep links, and direct pairing flows remain in place.
- The generated-project helper discovers the single Expo `.xcodeproj` instead of assuming `T3CodeDev.xcodeproj`; the showcase harness expects the generated `NorthBridgeCode.xcworkspace`, `NorthBridgeCode` scheme, and `NorthBridgeCode.app`.

## CLI, web, docs, and release metadata

- The public CLI command/help identity is `northbridgecode`. The npm package remains `t3`, and both `northbridgecode` and legacy `t3` bin aliases invoke the same command.
- Web titles, splash/wordmarks, desktop menus/dialogs, provider prompts, server labels, SSH prompts, schema descriptions, and user-facing diagnostics now say NorthBridgeCode.
- Legal fallback points to the existing KB-Helios repository LICENSE/security pages; operator override behavior is retained and no nonexistent privacy/terms pages are claimed.
- README and install docs no longer claim Ping-owned App Store, Play Store, hosted web, winget, Homebrew, or AUR distribution. They truthfully direct users to source builds or KB-Helios GitHub Releases and identify former T3 Code listings as not NorthBridgeCode distributions.
- Release workflow/smoke data, nightly resolution, Discord release notification text, desktop updater metadata, package repository metadata, and report headings use the NorthBridgeCode/KB-Helios identity.
- The checked-in `t3.json` filename and its functional `https://t3.codes/schema/t3.json` schema endpoint remain explicit compatibility exceptions so existing editors still resolve a real schema. Public descriptions and documentation now use NorthBridgeCode/KB-Helios.

## Visual assets

- Replaced the literal T3 glyph in the production, development, and nightly Icon Composer SVG sources with an NB mark.
- Replaced tracked public iOS, macOS, universal, Windows ICO, web favicon, Apple touch, and mobile/widget derivatives for all three channels. The web public favicon copies are updated too.
- Focused assertions verify the NB source markers, absence of the old glyph path in public sources, expected PNG dimensions, Windows ICO headers, changed hashes versus the former T3 raster outputs, and fully opaque RGB iOS 1024 images.
- The canonical asset pipeline remains the existing macOS `icons:export` / Icon Composer flow. A one-off Playwright/browser raster exporter and hash-lock manifest were intentionally not added.

## RED/GREEN evidence

RED progression included:

- Expo identity tests: 2 of 4 tests failed when the legacy schemes were accepted only by React Navigation but were not registered in Expo.
- Linux scheme tests: 2 of 6 tests failed while the desktop handler registered only the new scheme.
- The combined branding regression pass initially had 13 failures across 24 files / 205 tests, exposing remaining desktop launcher, CLI, legal, release, copy, and asset expectations.
- `rtk cmd /c vp test run scripts/northbridgecode-brand.test.ts` -> exit 1; 1 of 6 tests failed because the public npm package metadata did not yet include its NorthBridgeCode description.

Final GREEN:

- `rtk cmd /c vp test run` with the 25 focused desktop/mobile/server/web/contracts/SSH/release/asset test files -> exit 0; 25 files passed, 208 tests passed, duration 22.20s.
- `rtk cmd /c vp test run scripts/northbridgecode-brand.test.ts apps/server/src/bin.branding.test.ts` -> exit 0; 2 files passed, 7 tests passed.
- After review restored the functional schema compatibility URL: `rtk cmd /c vp test run packages/contracts/src/t3ProjectFile.test.ts packages/shared/src/t3ProjectFile.test.ts scripts/northbridgecode-brand.test.ts` -> exit 0; 3 files passed, 17 tests passed. Contracts/shared typechecks also exited 0.
- Scoped typechecks for `@t3tools/desktop`, `@t3tools/mobile`, `t3`, `@t3tools/web`, `@t3tools/contracts`, `@t3tools/shared`, and `@t3tools/ssh` -> exit 0. Desktop/server emitted only existing Effect suggestions.
- `EXPO_NO_TELEMETRY=1` production and development Expo config checks -> exit 0 with the NorthBridgeCode names, new IDs, new plus legacy schemes, no implicit owner/team/project/update URL, and updates disabled locally.
- Windows Android Expo prebuild -> exit 0 and generated `com.kbhelios.northbridgecode` plus `northbridgecode`, `t3code`, and Expo development scheme manifest handlers.
- `rtk cmd /c vp run build:bundle` in `apps/server` -> exit 0; 10 files, 13.26 MB.
- `rtk cmd /c vp run release:smoke` -> exit 0; `Release smoke checks passed.`
- `rtk cmd /c vp run dist:desktop:win:x64` -> exit 0; produced `release/NorthBridgeCode-0.0.32-x64.exe` and its blockmap.
- The Windows artifact command initially failed only when launched through the direct RTK Node wrapper: its nested `node --run build:bundle` process exited with Windows code `3221226505`. The identical nested command and full artifact build passed through `rtk cmd /c`, isolating this as an RTK Windows wrapper interaction rather than a source/build regression.
- `apps/server/src/bin.test.ts` is unchanged from `HEAD` and remains 451 lines; the CLI brand assertion is additive in `apps/server/src/bin.branding.test.ts`.
- Self-review rejected `https://github.com/KB-Helios/t3code#t3.json` because a repository anchor is not a JSON Schema document. The implementation, root config, generated-schema test, and brand allowlist now consistently retain the real `https://t3.codes/schema/t3.json` endpoint until separate hosting/redirect work exists.

## Remaining release gates

- This Windows host cannot generate the iOS native project, run Xcode/Simulator/device tests, export/validate native Icon Composer ICNS output, sign with the NorthBridgeCode Apple team, or perform live APNs/App Store validation. `expo prebuild --platform ios` correctly reports that iOS project generation requires macOS or Linux. A macOS release-machine pass remains mandatory.
- The local Windows installer build did not supply `--wsl-prebuild` / `T3CODE_DESKTOP_WSL_PREBUILD`, so electron-builder warned that this particular local artifact lacks a bundled Linux `pty.node` for its WSL backend. The Windows desktop code path and packaging remain present; the release pipeline must inject its normal WSL prebuild before publishing.
- Real Expo/EAS distribution builds still require KB-Helios/operator credentials and project metadata by design. Local config validation does not require them.
