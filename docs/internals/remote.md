# Remote Architecture

Remote environments use the same server RPC protocol as local environments. A client connects
directly over HTTP/WebSocket, authenticates with a scoped session credential, and projects the
server's environment, project, and thread state locally.

## Connection targets

- `PrimaryConnectionTarget` is managed by the current platform.
- `BearerConnectionTarget` stores direct HTTP/WS endpoints and a scoped credential.
- `SshConnectionTarget` stores an SSH launch profile; the resulting server connection is still
  direct from the desktop runtime.

Legacy persisted targets are decoded forward-compatibly so removed target variants can be skipped
without discarding valid Bearer or SSH records in the same document.

## Advertised endpoints

The server and desktop shell can advertise loopback, LAN, private-network, and public endpoints.
Each endpoint records its provider, reachability, availability, and HTTP/WS base URLs. Clients choose
an available endpoint appropriate to their network; loopback URLs are never offered as QR targets
for another device.

Tailscale endpoints are direct private-network endpoints. Tailscale Serve can provide HTTPS for
browser clients that require a secure origin.

## Pairing

A pairing URL is always rooted at the backend it pairs with:

```text
https://backend.example.test/pair#token=PAIRCODE
```

The client exchanges the one-time token at that backend and persists the resulting session locally.
The token stays in the URL fragment and is stripped after processing.

## Authentication

The server accepts browser session cookies and scoped Bearer access tokens. DPoP is an optional
proof-of-possession form for direct remote clients. Standard scopes cover orchestration, terminal,
and review operations; administrative credentials additionally cover access management.

## SSH and desktop hosting

Desktop can launch a server locally, in WSL, or through an SSH profile. These are lifecycle choices,
not alternate application protocols. Once launched, every environment exposes the same typed server
contract and connection state to the client runtime.

## Security model

- Network exposure is explicit and controlled where the server process is launched.
- Pairing tokens are short-lived and one-time use.
- Session credentials are scoped and revocable.
- Clients must not send credentials to an origin other than the selected backend.
- Private-network access is preferred over public exposure.
