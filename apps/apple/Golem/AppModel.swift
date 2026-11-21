import GolemKit
import Observation
import SwiftUI

/// The live link to a paired Mac, as the session list needs it. A fake stands in for it in UI tests.
@MainActor
protocol MacLink: AnyObject {
    /// Starts connecting and reports each state.
    func start() -> AsyncStream<ConnectionState>
    /// Reads the Mac's sessions into the list.
    func refresh(into list: SessionListModel) async throws
    func stop() async
}

/// The real link: one `Connection` to the Mac, through the relay.
@MainActor
final class ConnectionLink: MacLink {
    private let connection: Connection

    init(mac: PairedMac, key: any DeviceKey) {
        connection = Connection(config: mac.connectionConfig(), key: key)
    }

    func start() -> AsyncStream<ConnectionState> {
        let connection = connection
        return AsyncStream { continuation in
            let task = Task {
                for await state in await connection.states() { continuation.yield(state) }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
            Task { await connection.start() }
        }
    }

    func refresh(into list: SessionListModel) async throws {
        try await list.refresh(from: connection)
    }

    func stop() async {
        await connection.stop()
    }
}

/// What the app needs from the outside, so a test can swap it.
struct AppEnvironment {
    var store: any MacStore
    /// The phone's half of pairing. Throws when the device key cannot be made.
    var pairing: () throws -> any PairingService
    var link: (PairedMac) throws -> any MacLink
    var now: () -> Date = Date.init

    @MainActor
    static func live() -> AppEnvironment {
        let store = KeychainMacStore()
        return AppEnvironment(
            store: store,
            pairing: {
                RelayPairing(
                    key: try DeviceKeys.load(), deviceName: UIDevice.current.name,
                    deviceModel: UIDevice.current.model, store: store)
            },
            link: { ConnectionLink(mac: $0, key: try DeviceKeys.load()) })
    }
}

/// Which screen the app shows.
enum Screen: Equatable {
    /// Scan a code. `message` says why the last try failed.
    case scan(message: String?)
    /// Reaching the relay and the Mac.
    case connecting
    /// The words, waiting for the owner on the Mac.
    case confirm(words: [String])
    case paired(macName: String)
    case sessions
}

@MainActor @Observable
final class AppModel {
    private(set) var screen: Screen
    private(set) var macName = ""
    private(set) var connection: ConnectionState = .stopped(.stopped)
    private(set) var listError: String?
    let sessions = SessionListModel()

    private let environment: AppEnvironment
    private var pairingTask: Task<Void, Never>?
    private var pairingLink: PairLink?
    private var link: (any MacLink)?
    private var linkTask: Task<Void, Never>?

    init(environment: AppEnvironment) {
        self.environment = environment
        if let mac = try? environment.store.load() {
            macName = mac.name
            screen = .sessions
            startLink(to: mac)
        } else {
            screen = .scan(message: nil)
        }
    }

    // MARK: - Pairing

    /// A pair link from the camera, the paste field, or a tapped link.
    func handle(linkText text: String) {
        guard case .scan = screen else { return }
        let link: PairLink
        do {
            link = try PairLink(parsing: text, now: environment.now())
        } catch let failure as PairLink.Failure {
            screen = .scan(message: Self.message(for: failure))
            return
        } catch {
            screen = .scan(message: "That is not a golem pairing code.")
            return
        }
        let service: any PairingService
        do {
            service = try environment.pairing()
        } catch {
            screen = .scan(message: "This iPhone could not make its key.")
            return
        }
        screen = .connecting
        macName = link.macName
        pairingLink = link
        pairingTask = Task { [weak self] in
            do {
                for try await step in service.pair(with: link) {
                    guard let self else { return }
                    switch step {
                    case .connecting: self.screen = .connecting
                    case .words(let words): self.screen = .confirm(words: words)
                    case .paired(let name):
                        self.macName = name
                        self.screen = .paired(macName: name)
                    }
                }
            } catch {
                self?.screen = .scan(message: Self.message(for: error as? PairingFailure))
            }
        }
    }

    /// Back to the scanner, from any pairing screen.
    func cancelPairing() {
        pairingTask?.cancel()
        pairingTask = nil
        screen = .scan(message: nil)
    }

    /// After "Paired with …": on to the sessions.
    func continueToSessions() {
        guard case .paired = screen, let pairingLink else { return }
        let mac = PairedMac(link: pairingLink)
        self.pairingLink = nil
        screen = .sessions
        startLink(to: mac)
    }

    // MARK: - Sessions

    private func startLink(to mac: PairedMac) {
        linkTask?.cancel()
        let link: any MacLink
        do {
            link = try environment.link(mac)
        } catch {
            listError = "This iPhone could not make its key."
            return
        }
        self.link = link
        let states = link.start()
        linkTask = Task { [weak self] in
            for await state in states {
                guard let self else { return }
                self.connection = state
                if state == .connected { await self.refresh() }
                if case .stopped(let reason) = state, reason != .stopped { self.handleStop(reason) }
            }
        }
    }

    func refresh() async {
        guard let link else { return }
        do {
            try await link.refresh(into: sessions)
            listError = nil
        } catch {
            listError = "The Mac's sessions could not be read."
        }
    }

    private func handleStop(_ reason: StopReason) {
        switch reason {
        case .pairAgain, .revoked:
            // The Mac does not know this phone any more: forget it and ask for a new code.
            forgetMac()
        default:
            break
        }
    }

    /// Forgets the Mac on this phone. The Mac's own list of devices is not touched.
    func forgetMac() {
        linkTask?.cancel()
        let old = link
        link = nil
        Task { await old?.stop() }
        try? environment.store.forget()
        sessions.replace(with: [])
        connection = .stopped(.stopped)
        screen = .scan(message: nil)
    }

    // MARK: - Words for people

    static func message(for failure: PairLink.Failure) -> String {
        switch failure {
        case .notAPairLink: "That is not a golem pairing code."
        case .unsupportedVersion: "This code is from a newer golem. Update the app."
        case .badRelay: "This code names a relay the app will not use."
        case .malformed: "This pairing code is damaged. Make a new one on your Mac."
        case .expired: "This code has expired. Make a new one on your Mac."
        }
    }

    static func message(for failure: PairingFailure?) -> String {
        switch failure {
        case .expired?: "The code ran out or was already used. Make a new one on your Mac."
        case .wrongCode?: "Your Mac did not accept this code. Make a new one."
        case .refused?: "The pairing was refused on your Mac."
        case .macUnreachable?: "Your Mac is not reachable. Is golem running, with the relay set?"
        case .relayUnreachable?: "The relay cannot be reached. Check the network."
        case .failed?, nil: "Pairing did not work. Make a new code on your Mac and try again."
        }
    }
}
