# Grok

This guide is for people who want to sign in to Grok from another device. For first-time setup, see
[Install NorthBridgeCode](./install.md). For Codex, see [Codex](./providers-codex.md).

## Sign In From Settings

On the environment that runs the Grok CLI, open Settings → Providers and choose **Sign in** on the
Grok instance.

Grok uses a device code:

1. Open the verification link shown in Settings.
2. Enter the user code (for example `ABCD-EFGH`).
3. When the CLI finishes, the provider row shows as signed in.

You can do the same from a phone: Settings → Provider sign-in, then open the link and enter the
code. The phone never receives Grok tokens.

## Sign In On The Host

If you are already on the environment machine:

```bash
grok login --device-auth
```

Use a distinct `GROK_HOME` when you run more than one Grok instance. Endpoint-backed instances get
an isolated home automatically.

## Sign Out

Use **Sign out** on the same provider row. For an API-key or bearer auth profile, this removes the
stored secret. It does not send tokens to the client.
