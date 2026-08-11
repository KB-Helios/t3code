# NorthBridgeCode

NorthBridgeCode is a self-hosted agent harness control surface with web, Electron desktop, iOS,
and Android clients. Every client connects directly to the environments you operate; this fork does
not depend on a hosted relay or hosted web app.

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, and OpenCode. If they're set up on your computer, NorthBridgeCode can control them.

## "Wait, what are you selling me?"

Nothing. We built NorthBridgeCode because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> NorthBridgeCode currently supports Codex, Claude, Cursor, Grok Build and OpenCode. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Try it out (install-free)

The easiest way to test NorthBridgeCode is to run the server in your terminal (requires Node.js 22.16+, 23.11+, or 24.10+):

```bash
npx --package t3@latest northbridgecode
```

This will launch NorthBridgeCode's backend on your machine as well as the local web app to control your agents.

Tip: Use `npx --package t3@latest northbridgecode --help` for the full CLI reference. The legacy
`npx t3@latest` executable remains available for compatibility.

### Desktop app

Download NorthBridgeCode desktop artifacts from
[KB-Helios GitHub Releases](https://github.com/KB-Helios/t3code/releases). If the release you need
has not been published yet, build this repository from source; the former T3 Code store and package
registry listings are not NorthBridgeCode distributions.

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- Linux: [run NorthBridgeCode as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

NorthBridgeCode uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Support and issue tracking live in the [KB-Helios repository](https://github.com/KB-Helios/t3code).
