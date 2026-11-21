---
title: Run your own relay
description: Host the relay that connects your Mac and your phone, in one container, and point golem at it.
---

# Run your own relay

The relay is a small service that passes encrypted messages between your Mac and your paired phones. It sees who talks to whom, when, and how much, never what. Golem has a default relay; you can run your own instead. The design is [ADR-051](../adr/051-relay-and-pairing.md).

It is one container, and it keeps nothing on disk.

## Build and run it

The image is built from the relay package, so the build context is `packages/relay`. From the repository root:

```sh
docker build -t golem-relay packages/relay
docker run --rm -p 8080:8080 -e RELAY_HOST=relay.example.com golem-relay
```

`RELAY_HOST` is required. It is the host name your clients connect to, and it is part of every signature, so it must match the name in `[relay] url` below. Check that the relay is up:

```sh
curl http://localhost:8080/healthz
```

It answers `{"ok":true,"rooms":0,"sockets":0}`. The image runs as a non-root user and listens on port 8080.

To keep the settings in a file, use `--env-file relay.env` with one `NAME=value` per line.

## Settings

All settings are environment variables. Only `RELAY_HOST` is needed; the rest have defaults.

| Variable | Meaning | Default |
|---|---|---|
| `RELAY_HOST` | The host name clients connect to. Required | none |
| `BIND` | Where to listen. Plain WebSocket | `0.0.0.0:8080` |
| `TRUST_PROXY` | `1` reads the client address from `X-Forwarded-For`. Set it only behind a proxy you trust | off |
| `AUTH_TIMEOUT_S`, `IDLE_S`, `QUEUE_TTL_S` | Seconds to answer the challenge, to stay idle, to hold a message for an absent side | 5, 60, 60 |
| `QUEUE_MAX_FRAMES`, `QUEUE_MAX_BYTES` | Queue size per recipient | 64, 524288 |
| `MAX_DEVICES`, `MAX_SOCKETS_PER_DEVICE` | Phones per Mac, sockets per phone | 16, 2 |
| `IP_PER_MINUTE`, `IP_OPEN` | New and open unauthenticated connections per IP address | 10, 20 |
| `FRAMES_PER_SECOND`, `FRAME_BURST`, `BYTES_PER_SECOND` | Rate limits per socket | 100, 200, 1048576 |
| `MAX_SOCKETS` | Sockets in all | 10000 |

## Put TLS in front

The relay speaks plain WebSocket, and golem and the phone app accept only `wss://`. Put something in front that ends TLS and forwards to port 8080: Caddy, Fly.io, or a Cloudflare Tunnel. Set `TRUST_PROXY=1` when the proxy sets `X-Forwarded-For`, so the per-IP limits see the real client.

A Caddyfile for a host you own:

```
relay.example.com {
    reverse_proxy localhost:8080
}
```

## Point golem at it

In `~/.golem/config.toml`:

```toml
[relay]
url = "wss://relay.example.com"
```

The daemon reads this key once [#1008](https://github.com/MilanPavel/golem/issues/1008) lands. The host in the URL must equal `RELAY_HOST`.

## Push needs your own Apple team

A self-hosted relay serves the App Store app without push. Pairing, the live link, and answers all work while the app is open, and the app says plainly that push is not set up. Push works only if you build the app under your own Apple developer team and give the relay your own key: an Apple push key works only for the app of the team that owns it. Setting up push on the relay is not part of the container yet.

## Test with a phone

To try a relay on your laptop with your phone, without a domain, use a Cloudflare quick tunnel. It needs [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and no account.

1. In one terminal, run `cloudflared tunnel --url http://localhost:8080`. It prints a URL like `https://something.trycloudflare.com`.
2. In another, from the repository root: `RELAY_HOST=something.trycloudflare.com just relay`. This listens on `127.0.0.1:8080`, where the tunnel points.
3. Set `[relay] url = "wss://something.trycloudflare.com"` in `config.toml` and pair the phone.

The name changes every time `cloudflared` starts, so this is for testing only.
