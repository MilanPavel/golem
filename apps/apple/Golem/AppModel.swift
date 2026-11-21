import GolemKit
import Observation
import SwiftUI
import UserNotifications

/// The live link to a paired Mac, as the session list needs it. A fake stands in for it in UI tests.
@MainActor
protocol MacLink: AnyObject {
    /// Starts connecting and reports each state.
    func start() -> AsyncStream<ConnectionState>
    /// Reads the Mac's sessions into the list, and asks the Mac to push each change after this.
    func refresh(into list: SessionListModel) async throws
    /// Reads the Mac's runs.
    func refresh(into runs: RunsModel) async throws
    /// A session's new summary, each time one changes.
    func summaries() -> AsyncStream<InboxSession>
    func stop() async
    /// The full request for an Inbox item: the arguments, diff and folder come from the session's events.
    func approvalRequest(for item: InboxItem, folder: String?) async -> ApprovalRequest
    /// Answers approvals and hears when one is answered elsewhere.
    var approvals: any ApprovalChannel { get }
    /// Reads a session, replies, cancels, and makes new sessions.
    var sessionChannel: any SessionChannel { get }
    /// Answers given while the Mac could not be reached, and what became of them.
    var pendingAnswers: PendingAnswers { get }
}

/// The real link: one `Connection` to the Mac, through the relay.
@MainActor
final class ConnectionLink: MacLink {
    private let connection: Connection
    let pendingAnswers = PendingAnswers()

    var approvals: any ApprovalChannel { ConnectionApprovalChannel(connection: connection, pending: pendingAnswers) }
    var sessionChannel: any SessionChannel { ConnectionSessionChannel(connection: connection) }

    func approvalRequest(for item: InboxItem, folder: String?) async -> ApprovalRequest {
        await ApprovalRequestLoader.load(item: item, folder: folder, connection: connection)
            ?? ApprovalRequest(item: item, folder: folder)
    }

    init(mac: PairedMac, key: any DeviceKey) {
        connection = Connection(config: mac.connectionConfig(), key: key)
        let connection = connection
        let pending = pendingAnswers
        Task { pending.follow(await connection.outboxOutcomes()) }
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

    func refresh(into runs: RunsModel) async throws {
        try await runs.refresh(from: connection)
    }

    func summaries() -> AsyncStream<InboxSession> {
        let connection = connection
        return AsyncStream { continuation in
            let task = Task {
                for await summary in await connection.summaries() { continuation.yield(summary) }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func stop() async {
        pendingAnswers.stopFollowing()
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
    /// Puts the count on the app icon. Does nothing without the badge permission.
    var setBadge: @MainActor (Int) -> Void = { _ in }
    /// Face ID or the passcode, for an Always allow and a risky Allow once.
    var authenticator: any ApprovalAuthenticator = LocalAuthenticator()
    /// This phone's name, as the rule note shows it.
    var deviceName = "this iPhone"
    /// Whether the phone has a network, now and after each change.
    var network: () -> AsyncStream<Bool> = { NetworkMonitor.updates() }

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
            link: { ConnectionLink(mac: $0, key: try DeviceKeys.load()) },
            setBadge: { Badge.set($0) },
            deviceName: UIDevice.current.name)
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
    /// The tabs: Inbox, Automations, Chats.
    case tabs
}

/// The app icon's badge. It needs the user's permission for badges; without it, nothing happens.
enum Badge {
    @MainActor static func set(_ count: Int) {
        Task {
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            if settings.badgeSetting == .notSupported { return }
            if settings.authorizationStatus == .notDetermined {
                guard (try? await center.requestAuthorization(options: [.badge])) == true else { return }
            } else if settings.badgeSetting != .enabled {
                return
            }
            try? await center.setBadgeCount(count)
        }
    }
}

@MainActor @Observable
final class AppModel {
    private(set) var screen: Screen
    private(set) var macName = ""
    private(set) var connection: ConnectionState = .stopped(.stopped)
    private(set) var listError: String?
    /// Whether the phone itself has a network. It tells "no network" from "can't reach the relay".
    private(set) var networkAvailable = true
    /// When the Inbox was last read from, or pushed to by, the Mac.
    private(set) var lastUpdated: Date?
    let sessions = SessionListModel()
    let runs = RunsModel()
    /// The approval sheet that is open, if any. Whoever lists approvals sets it with `present(approval:)`.
    private(set) var presentedApproval: ApprovalSheetModel?
    /// The review card that is open, if any. Only set while `ReviewFeature` is on.
    private(set) var presentedReview: ReviewModel?

    private let environment: AppEnvironment
    private var pairingTask: Task<Void, Never>?
    private var pairingLink: PairLink?
    private var link: (any MacLink)?
    private var linkTask: Task<Void, Never>?
    private var summaryTask: Task<Void, Never>?
    private var runsTask: Task<Void, Never>?
    private var openingApproval = false
    private var networkTask: Task<Void, Never>?
    @ObservationIgnored private let inboxModel: InboxModel

    init(environment: AppEnvironment) {
        self.environment = environment
        inboxModel = InboxModel(sessions: sessions, runs: runs)
        if let mac = try? environment.store.load() {
            macName = mac.name
            screen = .tabs
            startLink(to: mac)
        } else {
            screen = .scan(message: nil)
        }
        let updates = environment.network()
        networkTask = Task { [weak self] in
            for await available in updates { self?.networkAvailable = available }
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
        screen = .tabs
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
        let summaries = link.summaries()
        summaryTask?.cancel()
        summaryTask = Task { [weak self] in
            for await summary in summaries {
                guard let self else { return }
                self.apply(summary)
            }
        }
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
            lastUpdated = environment.now()
            listError = nil
        } catch {
            listError = "The Mac's sessions could not be read."
        }
        updateBadge()
        link.pendingAnswers.prune(keeping: Set(inbox(now: environment.now()).needsYou.compactMap(\.callId)))
        // A Mac that does not answer `run.list` leaves Running and Today empty; the rest still works.
        try? await link.refresh(into: runs)
    }

    /// What the Inbox shows now.
    func inbox(now: Date) -> Inbox {
        inboxModel.inbox(now: nowMilliseconds(now))
    }

    /// A summary from the Mac: the session list and the badge change at once. A routine run's row has no
    /// event of its own, so the runs are read again, once for a burst of summaries.
    private func apply(_ summary: InboxSession) {
        if summary.status == "closed" {
            sessions.remove(sessionID: summary.sessionId)
        } else {
            sessions.update(summary)
        }
        lastUpdated = environment.now()
        updateBadge()
        guard runsTask == nil, let link else { return }
        runsTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard let self, !Task.isCancelled else { return }
            try? await link.refresh(into: self.runs)
            self.runsTask = nil
        }
    }

    private func updateBadge() {
        environment.setBadge(inboxModel.badgeCount(now: nowMilliseconds(environment.now())))
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
        summaryTask?.cancel()
        runsTask?.cancel()
        runsTask = nil
        let old = link
        old?.pendingAnswers.clear()
        link = nil
        Task { await old?.stop() }
        try? environment.store.forget()
        sessions.replace(with: [])
        runs.replace(with: [])
        lastUpdated = nil
        dismissApproval()
        environment.setBadge(0)
        connection = .stopped(.stopped)
        screen = .scan(message: nil)
    }

    // MARK: - Approvals

    /// Opens the approval sheet for a request. Nothing happens without a link to the Mac.
    func present(approval request: ApprovalRequest) {
        guard let link else { return }
        presentedApproval = ApprovalSheetModel(
            request: request, deviceName: environment.deviceName, authenticator: environment.authenticator,
            channel: link.approvals)
    }

    /// Opens the sheet for an approval in the Inbox. The Inbox item has no arguments or diff, so the link
    /// reads them from the session's events first; a tap while one is loading is ignored.
    func present(item: InboxItem) {
        guard let link, item.kind == .approval, item.callId != nil, !openingApproval else { return }
        // Its answer is queued; there is nothing to decide until the Mac has dealt with it.
        if let callId = item.callId, link.pendingAnswers.isWaiting(callId: callId) { return }
        openingApproval = true
        let folder = sessions.sessions.first { $0.sessionId == item.sessionId }?.cwd
        Task { [weak self] in
            let request = await link.approvalRequest(for: item, folder: folder)
            guard let self else { return }
            self.openingApproval = false
            self.present(approval: request)
        }
    }

    func dismissApproval() {
        presentedApproval?.stopFollowing()
        presentedApproval = nil
    }

    /// Opens the review card for a draft. The protocol has no review events yet, so this is off in a
    /// release build and a debug build opens a fixture.
    func present(review request: ReviewRequest, responder: any ReviewResponder) {
        guard ReviewFeature.isEnabled() else { return }
        presentedReview = ReviewModel(request: request, responder: responder)
    }

    func dismissReview() {
        presentedReview = nil
    }

    // MARK: - Sessions and new tasks

    /// The model for a session or run screen. Nil without a link to the Mac.
    func sessionDetail(sessionID: String, title: String) -> SessionDetailModel? {
        link.map { SessionDetailModel(sessionID: sessionID, title: title, channel: $0.sessionChannel) }
    }

    /// The model for the new-task screen, with the folders sessions ran in. Nil without a link to the Mac.
    func newTask() -> NewTaskModel? {
        link.map { NewTaskModel(folders: recentFolders(sessions.sessions), channel: $0.sessionChannel) }
    }

    // MARK: - Offline

    /// The banner for the connection now, or nil when all is well.
    var banner: OfflineBanner? {
        OfflineBanner.make(
            state: connection, networkAvailable: networkAvailable, waiting: link?.pendingAnswers.waitingCount ?? 0)
    }

    /// What became of an answer given for this Inbox item while the Mac could not be reached.
    func pendingAnswer(for item: InboxItem) -> PendingAnswer? {
        guard let callId = item.callId else { return nil }
        return link?.pendingAnswers.answer(for: callId)
    }

    /// "Updated 08:47" while the Inbox is not live, so it reads as what was last known.
    var staleText: String? {
        guard connection != .connected, case .tabs = screen else { return nil }
        return OfflineBanner.updatedText(lastUpdated)
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
