# One golem, wherever you are

## One daemon, many clients

![Five clients reach one daemon: the terminal over the Unix socket, and the browser, the Mac app, the iPhone, and your app through the gateway](../images/vision-doors.svg)

Phones, apps, and other golems all need to reach golem over a network. The question is how to do that without making golem complicated.

**The socket stays.** The daemon listens on a Unix socket, and only there. The protocol is the contract; the socket is only one way to carry it.

**Everything that faces a network is the gateway.** The gateway is a part of the `golem` binary ([ADR-028](../adr/028-web-gateway.md)). It opens the ports a given setup needs, checks who is knocking, and passes each connection on to the daemon's socket. The web UI already works this way.

- **The daemon does not change.** No ports, no TLS, no logins. "The file's mode is the login" stays true inside every machine.
- **Network security lives in one place.** Tokens, pairing, `Origin` checks, and rate limits are one program, next to the client library.
- **The simplest remote link needs no gateway.** OpenSSH can forward a Unix socket, so one golem can attach to another over `ssh`.

**Two APIs, on purpose.** Golem's own clients (the terminal, the web UI, the native apps, a parent golem) speak the full golem protocol, which keeps changing. Applications get a small, stable **app API**: start a run, follow its events, answer an approval, and the familiar `/v1/chat/completions`. The gateway translates. Keeping them apart lets the protocol grow without breaking anyone's app.

**One release, different modes.** The same build runs as your *personal* golem (started by launchd), as a *child* started by another golem, or in *serve* mode behind an app. A mode is a setting, not a new code path.

---

## The native apps

![A Mac and an iPhone share one SwiftUI package. An approval appears on the Mac, follows you to the phone's lock screen, Face ID allows it, and a Live Activity shows the tests running](../images/vision-clients.svg)

The terminal is where golem is built. The [web UI](../architecture/web.md) is where it is easiest to read. The native apps are where golem *finds you*: on the menu bar while you work, on your lock screen when you are away.

**One app family, in SwiftUI.** The Mac app and the iPhone app are one codebase. A shared Swift package, GolemKit, holds the protocol types (written by `just gen` from the same schemas as the Python and TypeScript ones), the connection with its resume-from-`seq`, and the view state that turns events into a transcript. Each app adds only what its device does best. A native app is a second UI written screen by screen, and that only pays off because one codebase covers both devices.

### On the Mac

- **A menu bar golem:** is the daemon up, what is running, what today has cost.
- **Notifications you answer:** Allow and Deny on an approval, without opening anything.
- **A global hotkey** for a quick "ask golem" window, like Spotlight.
- **Drop anything on it:** a file, a folder, a screenshot, a link.
- **Runs and sub-agents as a timeline** you can click into (see [below](./sub-agents.md#seeing-it-work)).

### On the iPhone

The phone is not a small terminal. It is where you **watch and decide** while you are away.

- **Approve from the lock screen,** with the command or the diff in front of you, and Face ID for anything risky.
- **Watch a run** in a Live Activity: "golem · running tests · step 4 of 9".
- **Start work:** pick a recent project, type or dictate a task, or start a workflow.
- **Send things to golem** from the share sheet, and ask it through Siri and Shortcuts.

### How the phone reaches the Mac

A phone on 5G cannot call a Mac behind a home router, and iOS freezes apps in the background. So the phone reaches golem in one of three ways: the same Wi-Fi (the gateway announces itself with Bonjour), a private network such as Tailscale, or a small **relay** that both sides connect out to, which also sends the push notifications. Pairing once with a QR code gives the phone and the Mac each other's keys, so the relay only ever forwards encrypted bytes, and keeps nothing. If it is down, nothing is lost: the event log replays when the phone gets through.

While a run is active or waiting for you, the Mac can stay awake until it finishes. For a golem that never sleeps, use a Mac mini, or let a [sub-agent run elsewhere](./sub-agents.md#somewhere-else).

---
