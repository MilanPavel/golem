# golem for iPhone

The iPhone app (ADR-052, ADR-051). SwiftUI on iOS 17, built on the shared `GolemKit` package.

```
apps/apple/
  GolemKit/        Swift package: protocol types, the connection, pairing, view state
  Golem/           the app: screens, assets, Info.plist, entitlements
  GolemUITests/    UI tests with a fake pairing
  Config/          Golem.xcconfig: bundle id, Keychain group, team
  project.yml      XcodeGen input. Golem.xcodeproj is generated and not checked in
```

## Prerequisites

- A Mac with Xcode 16 or newer (the iOS Simulator runtime installed) and macOS 15 or newer.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`.
- For `just ios` the tests also need [`bun`](https://bun.sh) (GolemKit's tests start the real relay).

## Build and test: `just ios`

```sh
just ios
```

It runs `xcodegen`, builds the app for the Simulator with signing off, runs GolemKit's tests, and runs the app's UI tests on the "iPhone 18 Pro" Simulator. Pick another with `IOS_DEVICE="iPhone 17"`. `just ios` says so when `xcodegen` is missing.

## Run on the Simulator

```sh
cd apps/apple && xcodegen && open Golem.xcodeproj
```

Pick the Golem scheme and a Simulator, then Run. The Simulator has no camera, so the pairing screen has a **Paste pair link** button (debug builds only).

### Pair with a local relay, end to end

1. In one terminal: `RELAY_HOST=127.0.0.1 just relay`. The relay listens on `127.0.0.1:8080`. `RELAY_HOST` must be the host in the URL below, because it is part of every signature.
2. In `~/.golem/config.toml`:
   ```toml
   [relay]
   url = "ws://127.0.0.1:8080"
   ```
   The app accepts a plain `ws://` only for a loopback address.
3. Start golem, then run `golem devices pair --link`. It prints a QR code and the `golem://pair?...` link.
4. In the Simulator, tap **Paste pair link**, paste the link (copy it on the Mac, then paste in the field), tap **Pair**.
5. The app shows three words. Compare them with the Mac and confirm there. The app says "Paired with <your Mac>", and **Continue** shows the Mac's sessions.

A `golem://pair` link opens the app and starts pairing in every build, so the Camera app or a tapped link works too: `xcrun simctl openurl booted '<link>'` (iOS asks to open Golem first). The words and the confirmation on the Mac still guard it. Other `golem://` links are ignored.

For a run from the shell with no taps, build with ad-hoc signing (the `just ios` build has signing off, so the Simulator's Keychain refuses the device key with -34018) and start the app with the link as a launch argument (debug builds only):

```sh
xcodebuild build -project Golem.xcodeproj -scheme Golem -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath build CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/Golem.app
xcrun simctl launch booted dev.golem.app -pairLink 'golem://pair?...'
```

## Run on a real iPhone, with a free Personal Team

No paid developer account is needed, but the profile lasts 7 days, then you build again.

1. Create `apps/apple/Config/Local.xcconfig` (not checked in):
   ```
   GOLEM_BUNDLE_ID = com.yourname.golem
   GOLEM_KEYCHAIN_GROUP = com.yourname.golem.shared
   DEVELOPMENT_TEAM = ABCDE12345
   ```
   The bundle id must be one nobody else uses. Your team id is in Xcode › Settings › Accounts, or in the Personal Team's certificate.
2. On the iPhone: Settings › Privacy & Security › Developer Mode, on. It restarts the phone.
3. `cd apps/apple && xcodegen && open Golem.xcodeproj`, choose your iPhone, Run. Xcode signs with your team.
4. On the first launch iOS says the developer is not trusted: Settings › General › VPN & Device Management › your Apple ID › Trust.
5. Scan the code from `golem devices pair`. The phone cannot reach `127.0.0.1` on your Mac, and the app needs `wss://`, so use a Cloudflare quick tunnel as in [Run your own relay](../../docs/guide/relay.md): `cloudflared tunnel --url http://localhost:8080`, then `RELAY_HOST=<name>.trycloudflare.com just relay`, and `url = "wss://<name>.trycloudflare.com"` in `config.toml`.

On a device the device key is made in the Secure Enclave. On the Simulator, which has none, it is a software key in the Keychain.

## Settings in `project.yml`

The bundle id, the Keychain access group and the team are build settings (`Config/Golem.xcconfig`), not constants in code, because a self-hosted relay's push needs the host's own team. The defaults (`dev.golem.app`) are placeholders.

## TestFlight

Not set up yet. See [#1547](https://github.com/MilanPavel/golem/issues/1547).
