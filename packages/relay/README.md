# golem relay

A small public service that passes encrypted frames between a Mac and its paired phones. It sees who talks to whom, when, and how much, never what. The design is [ADR-051](../../docs/adr/051-relay-and-pairing.md).

- `/v1/mac` and `/v1/device`: one WebSocket per side. Each proves its P-256 key by signing the relay's challenge.
- One room per Mac key. The Mac sends the whole allow list of device keys; a device not on it gets 4401, and a device removed from it gets 4403 at once.
- Data frames are binary, at most 32 KiB, and pass unread. A frame for a side that is away waits in memory for 60 seconds (at most 64 frames and 512 KiB), then is dropped.
- `/healthz` returns `{"ok":true,"rooms":n,"sockets":n}`.
- Nothing is written to disk. Logs hold an event name, a time, a request number, short id prefixes, a close code, and a count. Never a frame, a key, a token, or an IP address.

## Run it

```sh
RELAY_HOST=relay.example.com BIND=0.0.0.0:8080 bun packages/relay/src/bun/main.ts
```

It speaks plain WebSocket. Put TLS in front (Caddy, Fly, a Cloudflare Tunnel).

| Variable | Meaning | Default |
|---|---|---|
| `RELAY_HOST` | The host name clients connect to. It is inside every signature. Required | none |
| `BIND` | Where to listen | `0.0.0.0:8080` |
| `TRUST_PROXY` | `1` reads the client address from `X-Forwarded-For` (only behind a proxy you trust) | off |
| `AUTH_TIMEOUT_S`, `IDLE_S`, `QUEUE_TTL_S` | Seconds to answer the challenge, to stay idle, to hold a frame | 5, 60, 60 |
| `QUEUE_MAX_FRAMES`, `QUEUE_MAX_BYTES` | Queue size per recipient | 64, 524288 |
| `MAX_DEVICES`, `MAX_SOCKETS_PER_DEVICE` | Per Mac, per device | 16, 2 |
| `IP_PER_MINUTE`, `IP_OPEN` | New and open unauthenticated connections per IP | 10, 20 |
| `FRAMES_PER_SECOND`, `FRAME_BURST`, `BYTES_PER_SECOND` | Per socket | 100, 200, 1048576 |
| `MAX_SOCKETS` | Sockets in all, then 1013 | 10000 |

## Layout

- `src/hub.ts`: rooms, authentication, the allow list, forwarding. Web-standard APIs only; the runtime is behind the `Conn` interface.
- `src/protocol.ts`: close codes, limits, frame layouts, key encodings.
- `src/queue.ts`, `src/limits.ts`, `src/log.ts`: the queue, the rate limits, the log.
- `src/bun/`: the `Bun.serve` adapter, the environment settings, and `main.ts`.

## Wire details this package fixes

ADR-051 leaves these open. They are the relay's choices, to match in the gateway and the app:

- Keys are the raw 65-byte uncompressed P-256 point, signatures the raw 64-byte `r‖s`, the nonce, room id, and device ids base64url without padding.
- The signed message is the UTF-8 text `"golem-relay-v1\0"` + `role` (`mac` or `device`) + relay host + nonce.
- The `v` field of `auth` is optional; if present it must be 1.
- `seq` is compared within one Mac socket. A new Mac socket starts over, so a Mac that restarted can send its list again.
