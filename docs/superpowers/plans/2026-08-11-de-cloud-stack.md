# De-cloud Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One implementation subagent maximum per branch; the primary agent performs reviews and integration.

**Goal:** Produce a three-PR stack that repairs the De-cloud branch, restores relay-free iOS push/Live Activities, and rebrands public product identity to NorthBridgeCode.

**Architecture:** Finish removal at every caller and automation boundary, migrate old persisted catalogs without data loss, add an environment-owned APNs adapter behind authenticated registration, then rebrand only public surfaces while preserving internal compatibility names.

**Tech Stack:** TypeScript, Effect, React, Electron, React Native/Expo, SQLite/local persistence, APNs HTTP/2, Vite+, GitHub Actions.

## Global Constraints

- Branch stack and bases must match the approved design exactly.
- Use one implementation subagent maximum per branch.
- Do not merge a broken intermediate branch into `main`.
- Preserve Windows WSL, SSH, Tailscale, preview, updater, IPC, and NSIS behavior.
- Preserve iOS Liquid Glass, navigation, sharing, widgets, notifications, and Live Activities.
- Do not restore Clerk, T3 Connect, the managed relay, hosted `app.t3.codes`, cloud telemetry, or deleted marketing infrastructure.
- Keep internal `@t3tools/*` names and compatibility environment variables unless a public identity requires an alias.
- Use focused checks only; do not run repository-wide checks.

---

### Task 1: Repair the De-cloud branch

**Files:**
- Modify: `packages/client-runtime/src/platform/storageDocument.ts`
- Modify/Test: web, desktop, and mobile connection storage/migration files
- Modify/Test: remaining desktop/web/mobile Clerk and relay callers
- Modify/Test: `apps/server/src/auth/RpcAuthorization.ts`, `apps/server/src/ws.ts`, server package/build staging
- Modify: `.github/workflows/release.yml`, `.github/workflows/deploy-relay.yml`, root scripts, `t3.json`, release smoke/reference repos

**Produces:** A buildable `codex/de-cloud-repair` branch with a lossless legacy catalog migration and no references to deleted cloud modules or workspaces.

- [ ] Add a legacy-v1 migration test containing one relay target plus valid Bearer and SSH entries; verify current `de-cloud` decoding fails or clears the document.
- [ ] Implement the minimum decoder/migration that filters relay-owned records and retains valid direct records.
- [ ] Remove remaining production and test imports of deleted Clerk/relay/hosted-pairing modules while preserving direct connection flows.
- [ ] Align server RPC contracts, authorization, and handlers after launcher self-update removal.
- [ ] Remove stale release, deploy, worktree, root-script, reference-repo, and smoke-fixture wiring.
- [ ] Run focused typechecks/tests, server bundle, release smoke, and `git diff --check`.
- [ ] Commit, push, and open a draft PR targeting `de-cloud`.

### Task 2: Add environment-owned iOS push and Live Activities

**Files:**
- Create/Modify: server mobile registration persistence and APNs transport modules under `apps/server/src/`
- Modify: authenticated contracts/RPC or HTTP surface in `packages/contracts`
- Modify: orchestration activity reactor integration
- Modify: `apps/mobile/src/features/agent-awareness/`
- Modify: mobile settings and connection lifecycle integration

**Produces:** `codex/self-hosted-ios-push`, with mobile devices registering directly to each environment and APNs delivery owned by that environment.

- [ ] Add failing contract and persistence tests for authenticated environment-scoped device registration.
- [ ] Add failing APNs transport tests covering notification and Live Activity token payloads with a fake transport.
- [ ] Implement local registration persistence, APNs configuration, delivery, and orchestration integration.
- [ ] Add failing mobile tests for registering/unregistering each connected environment without Clerk or managed relay.
- [ ] Implement direct mobile registration and settings state while keeping local features available when APNs is unconfigured.
- [ ] Run focused server/contracts/mobile typechecks and tests plus `git diff --check`.
- [ ] Commit, push, and open a draft PR targeting `codex/de-cloud-repair`.

### Task 3: Rebrand public identity to NorthBridgeCode

**Files:**
- Modify/Test: desktop identity, environment, launcher, packaging, updater, resources, and state migration
- Modify/Test: mobile Expo config, deep links, bundle/app-group/extension identifiers, visible copy, and assets
- Modify/Test: web titles/copy, server/CLI public metadata, docs, schemas, and release workflows

**Produces:** `codex/northbridgecode-brand`, a public NorthBridgeCode build that retains upgrade compatibility with T3 Code state.

- [ ] Add failing desktop identity/state migration tests for `NorthBridgeCode`, `com.kbhelios.northbridgecode`, and `northbridgecode://`.
- [ ] Implement desktop public branding and installer/updater metadata without renaming internal packages.
- [ ] Add failing Expo config tests for names, bundle identifiers, app groups/extensions, and deep-link schemes.
- [ ] Implement mobile branding with KB-Helios-owned signing/update placeholders that fail clearly when credentials are absent.
- [ ] Update visible web/server/docs/release identity and add focused assertions for public metadata.
- [ ] Run focused typechecks/tests, desktop packaging checks available on Windows, Expo config/prebuild validation, and `git diff --check`.
- [ ] Commit, push, and open a draft PR targeting `codex/self-hosted-ios-push`.

