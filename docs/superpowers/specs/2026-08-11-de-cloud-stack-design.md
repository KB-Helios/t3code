# De-cloud Stack Design

## Objective

Turn the `de-cloud` branch into a buildable, self-hosted fork that preserves the Windows desktop and iOS product surfaces, replaces relay-dependent iOS delivery with environment-owned APNs delivery, and then changes the public product identity to `NorthBridgeCode`.

## Branch stack

1. `codex/de-cloud-repair` targets `de-cloud`.
2. `codex/self-hosted-ios-push` targets `codex/de-cloud-repair`.
3. `codex/northbridgecode-brand` targets `codex/self-hosted-ios-push`.

Each branch has one concern and one implementation subagent maximum. The primary agent integrates, reviews, verifies, commits, pushes, and opens the draft PR.

## Repair branch

The repair branch completes the removal already started by `de-cloud` without reintroducing T3 Cloud. It removes remaining Clerk, relay, hosted-pairing, hosted-web, marketing, deploy, and service-launcher references. Direct Bearer, SSH, local pairing, WSL, Tailscale, desktop updates, previews, mobile sharing, widgets, native navigation, and local Live Activity rendering remain.

Persisted connection documents remain schema version 1 at rest, but decoding accepts the former relay-shaped v1 document and migrates it by filtering relay targets and relay-owned credentials while retaining direct Bearer and SSH entries. Web, desktop, and mobile stores use that migration rather than clearing the entire catalog.

The server RPC group and authorization table remove self-update RPCs whose launcher-backed implementation was deleted. Desktop-managed Electron updates remain.

Release and development automation must not refer to deleted workspaces or files. Hosted web deployment is removed rather than restoring `app.t3.codes` routing.

## Self-hosted iOS push branch

Each environment server owns its mobile device registrations and APNs credentials. An authenticated client registers notification and Live Activity tokens directly with the environment it already connects to. The server persists registrations locally and sends APNs updates from orchestration activity without Clerk, a global account, a managed relay, PlanetScale, Cloudflare, or Axiom.

Registration is environment-scoped and uses the existing Bearer-authenticated HTTP/RPC boundary. Missing APNs configuration makes remote delivery unavailable without breaking local widgets, sharing, or task control. Secrets stay server-side. Tests use a fake APNs transport and real registration persistence; no test calls Apple.

## Branding branch

Public identity changes to `NorthBridgeCode`: display names, desktop product and installer metadata, executable/protocol names, Windows AppUserModelID, iOS app names and bundle identifiers, app groups/extensions, deep-link schemes, visible copy, assets, updater repository metadata, and owned Expo/Apple configuration.

Internal package names such as `@t3tools/*`, database schema names, and legacy `T3CODE_*` environment variables remain for compatibility. New public identifiers use `northbridgecode`; existing state paths get an explicit migration so upgrades do not lose settings or connections.

The existing separate NorthBridge iOS bundle identifier is not reused by default. This fork uses `com.kbhelios.northbridgecode` unless repository configuration already declares another KB-Helios-owned identifier.

## Verification gates

- Focused package typechecks for client-runtime, server, web, desktop, and mobile.
- Focused tests for migration, connection storage, RPC authorization/group completeness, desktop startup, mobile registration, APNs delivery, and branding identity.
- Server bundle build and release-smoke check on the repair branch.
- Windows desktop artifact build on the repaired/branded stack.
- Expo configuration/prebuild validation plus an iOS build on macOS before calling the iOS stack release-ready.
- `git diff --check` before every commit and PR.
