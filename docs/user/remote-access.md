# Remote Access

T3 Code clients connect directly to a T3 Code server over HTTP and WebSocket. You can use a LAN
address, Tailscale, or an SSH-launched server. Pairing exchanges a short-lived one-time token for a
scoped session credential.

## Quick pairing

With a server already running, generate a direct pairing URL:

```bash
npx t3 pair
```

The URL points at the server itself and keeps the token in its hash:

```text
https://host.example.test/pair#token=PAIRCODE
```

Open the complete URL in the web, desktop, or mobile client that should connect. If no server is
running, start one with `npx t3 serve` and run `npx t3 pair` again.

## Desktop network access

Open **Settings > Connections** on the host desktop. Enable network access, then choose a reachable
advertised endpoint. LAN endpoints work for devices on the same network. Tailscale endpoints work
for devices on the same tailnet and avoid exposing the server to the public internet.

Tailscale Serve can provide HTTPS when the consuming browser requires a secure origin. Follow the
endpoint shown by T3 Code rather than configuring a separate proxy by hand.

## Headless server

Run the server on the interface you intend to expose:

```bash
npx t3 serve --host 0.0.0.0
```

Protect network access with the pairing flow and restrict the host firewall to the networks that
need it. For a persistent Linux service, see [Running T3 Code in the Background](./background-service.md).

## SSH launch

Desktop can save an SSH profile and launch a remote T3 server through that host. SSH remains the
transport for starting and reaching the server; the client still uses the same scoped Bearer session
credentials after pairing.

## Managing access

Settings lists pairing links and authenticated client sessions. Revoke a pairing link to prevent
future use, or revoke a session to disconnect that client. Administrative sessions can revoke other
sessions; standard sessions cannot.

## Security notes

- Treat pairing URLs and Bearer credentials as secrets.
- Prefer Tailscale or another private network over public exposure.
- Use HTTPS/WSS when crossing an untrusted network.
- Pairing URLs retain credentials in the fragment so they are not sent as part of an HTTP request,
  but browser history, screenshots, logs, and clipboard contents can still expose them.
