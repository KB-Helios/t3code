# Task 1 Report: Repair the De-cloud Branch

## Status

DONE_WITH_CONCERNS

## Summary

- Made legacy v1 connection documents forward-compatible: legacy managed-relay records are filtered while valid Bearer and SSH records, profiles, and credentials survive migration.
- Removed stale Clerk, managed-relay, hosted pairing/app, cloud telemetry, and launcher self-update callers across web, desktop, mobile, contracts, client runtime, and server.
- Preserved direct Bearer/SSH/local pairing, WSL, Tailscale, desktop IPC/protocols, previews, desktop updater behavior, Windows NSIS packaging, and mobile local Live Activity rendering/arming.
- Removed deleted cloud workspace/deploy/reference/smoke wiring and regenerated the lockfile without Clerk dependencies.
- Restored the accidentally deleted local mock update server and made release-smoke Windows-path handling platform-neutral.

## Files changed

- Connection migration and direct runtime: `packages/client-runtime/src/platform/storageDocument.ts`, client runtime authorization/connection/RPC/state files and focused tests.
- Contracts/server: `packages/contracts/src/{environment,rpc,server}.ts`, `apps/server/src/environment/ServerEnvironment.ts`, server build and publish staging.
- Desktop: Clerk integration removal, connection catalog migration, protocol/preload/main cleanup, saved-environment compatibility, Vite/package cleanup.
- Web: hosted/cloud bootstrap and settings removal, direct pairing/runtime preservation, manual version-skew guidance after launcher update removal.
- Mobile: managed relay/auth/registration/preferences/telemetry removal, direct environment persistence, Web Crypto service, and local Live Activity bridge.
- Release/root: `.github/workflows/{ci,release}.yml`, deleted `deploy-relay.yml`, root/package/workspace/lock/t3 config, public config, reference repos, release smoke, desktop artifact staging, dev runner, and restored `scripts/mock-update-server.ts`.

## Commits

- `aefffa115ee641abbb25ef7708639148b3628124` — `fix: repair de-cloud build`
- Documentation-only follow-up containing this report (the next commit on the branch).

## Focused tests and checks

- RED: `rtk vp test run packages/client-runtime/src/platform/storageDocument.test.ts` — exit 1; 1 failed / 3 passed, with the legacy relay entry causing a schema decode failure.
- GREEN: same storage command — exit 0; 4/4 passed after applying `ForwardCompatibleArray` to persisted targets.
- `rtk vp test run packages/client-runtime/src/authorization/layer.test.ts packages/client-runtime/src/connection/registry.test.ts packages/client-runtime/src/connection/resolver.test.ts packages/client-runtime/src/connection/supervisor.test.ts packages/client-runtime/src/platform/storageDocument.test.ts packages/client-runtime/src/rpc/client.test.ts` — exit 0; 6 files, 63/63 tests.
- `rtk vp test run apps/desktop/src/app/DesktopConnectionCatalogStore.test.ts apps/desktop/src/electron/ElectronProtocol.test.ts` — exit 0; 2 files, 15/15 tests.
- `rtk vp test run apps/mobile/src/connection/migration.test.ts apps/mobile/src/lib/connection.test.ts apps/mobile/src/lib/storage.test.ts apps/mobile/src/state/workspaceModel.test.ts apps/mobile/src/features/showcase/showcaseEnvironmentRows.test.ts` — exit 0; 5 files, 19/19 tests.
- `rtk vp test run scripts/mock-update-server.test.ts scripts/lib/public-config.test.ts scripts/sync-reference-repos.test.ts scripts/build-desktop-artifact.test.ts scripts/dev-runner.test.ts packages/client-runtime/src/state/server.test.ts apps/web/src/versionSkew.test.ts` — first run exit 1 with one stale `alchemy-effect` expectation; after correction exit 0, 7 files and 123/123 tests.
- `rtk vp test run scripts/build-desktop-artifact.test.ts` after final native-package cleanup — exit 0; 1 file, 29/29 tests.
- `rtk vp run --filter @t3tools/contracts --filter @t3tools/client-runtime --filter @t3tools/web --filter @t3tools/desktop --filter @t3tools/mobile --filter t3 --filter @t3tools/scripts typecheck` — exit 0 for all 7 packages in 17.2s; only existing Effect suggestion diagnostics were printed.
- `rtk vp run --filter t3 build:bundle` — exit 0 in 6.7s; `vp pack` produced 10 files and completed the server bundle.
- `rtk vp run release:smoke` — sandbox run timed out on npm network denial; escalated run first proved a Windows Bash-path RED, then the platform-neutral implementation passed with exit 0 in 9s and printed `Release smoke checks passed.`
- `rtk node --input-type=module -e "...YAML.parse..."` from `scripts/` — exit 0; `release.yml parsed`.
- `rtk git diff --check` and `rtk git diff --cached --check` — exit 0 with no output.

## Self-review findings

- Confirmed release workflow retains desktop builds, WSL node-pty staging, Windows NSIS, updater manifest merging, CLI publication, GitHub release creation, and release finalization while removing relay config/tracing and hosted Vercel deployment.
- Confirmed local mobile Live Activity behavior remains through `AgentActivity`, `localLiveActivity.ts`, `ThreadComposer`, and `NewTaskDraftScreen`; only managed registration, replay, and preference surfaces were removed.
- Confirmed production/root wiring has no references to deleted Clerk packages, relay-auth modules, relay/marketing workspaces, service-launcher bundle, or hosted-app build variables.
- Confirmed `.pnpm-store/` is not staged.

## Remaining concerns

- Dependency/bootstrap commands inside the sandbox encountered npm registry `EACCES` retries. The required release smoke passed outside the network sandbox, and the resulting root lockfile was validated by that smoke fixture.
- `.pnpm-store/` remains as an untracked directory created by the bootstrap attempt; it was preserved and excluded from commits per instruction.
- Native iOS simulator/device and signed desktop packaging were not run on this Windows host; focused TypeScript/tests, artifact configuration tests, server bundle, and release smoke are green.
