# Release Checklist

The release workflow validates the repository, builds desktop artifacts, publishes the CLI, creates
the GitHub release, and updates stable package versions. Desktop release coverage includes macOS
DMG/ZIP output, Linux AppImage output, Windows NSIS installers, updater manifests, resource-monitor
binaries, and the WSL `node-pty` prebuild used by Windows hosts.

## Required credentials

Configure the repository's npm trusted publisher for the CLI job. Signed macOS releases require the
Apple signing certificate, notarization API key, team identifier, and signing password used by the
workflow. Signed Windows releases require the Azure Trusted Signing tenant, client, endpoint,
account, certificate profile, and publisher values referenced in `.github/workflows/release.yml`.

Unsigned workflow-dispatch builds do not require signing credentials.

## Validation

Before publishing a tag:

1. Run focused tests for the changed packages.
2. Run `vp run release:smoke` to verify version rewriting and macOS/Windows updater manifest merges.
3. Verify the server bundle and desktop packaging configuration.
4. Confirm the target version is consistent in the server, desktop, web, and contracts manifests.

The workflow performs its own preflight checks before build jobs start.

## Nightly builds

The scheduled workflow derives a nightly version from the date, run number, and commit SHA. Nightly
desktop artifacts and CLI packages use the nightly update channel and prerelease GitHub release.
Stable releases use the latest channel.

## Desktop updater notes

macOS universal update metadata must contain both arm64 and x64 ZIP assets. Windows metadata is
merged from architecture-specific NSIS manifests for latest, nightly, and preview channels. Builder
debug YAML files are not updater manifests and must remain untouched by the merge step.

The local mock update server is available through `vp run start:mock-update-server` for exercising
desktop updater behavior without publishing artifacts.

## Release flow

1. Dispatch an unsigned build when validating packaging changes.
2. Confirm every requested platform artifact was uploaded.
3. Configure signing credentials before a public stable release.
4. Create the release tag through the workflow rather than publishing local artifacts manually.
5. Verify the CLI package, GitHub release assets, updater YAML, DMG/ZIP, AppImage, and NSIS output.

Do not publish a test tag to validate configuration; use workflow dispatch and dry-run paths.
