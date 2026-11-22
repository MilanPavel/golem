import Foundation
import Observation

// A session or a run, read on the phone: the transcript, the reply, the cancel, and the result.
// A routine's run is a session, so one model serves both. A new task makes a session first.

/// The Mac, as the session view and the new-task screen need it.
public protocol SessionChannel: Sendable {
    /// Every followed session's events. The stream is open when this returns, so an attach after it
    /// loses no replayed event.
    func events() async -> AsyncStream<GolemEvent>
    /// `session.attach` from the start of the log.
    func attach(sessionId: String) async throws
    /// `session.detach`.
    func detach(sessionId: String) async
    /// `message.send`. Returns the id of the run that answers.
    @discardableResult
    func send(sessionId: String, text: String) async throws -> String
    /// `run.cancel`.
    func cancel(runId: String) async throws
    /// `session.create` in a folder; nil is the Mac's default folder. Returns the new session's id.
    func create(folder: String?) async throws -> String
}

public enum SessionFailure: Error, Equatable {
    case failed(String)

    public var message: String {
        switch self {
        case .failed(let message): message
        }
    }
}

/// The session calls over the connection.
public struct ConnectionSessionChannel: SessionChannel {
    private let connection: Connection

    public init(connection: Connection) {
        self.connection = connection
    }

    public func events() async -> AsyncStream<GolemEvent> {
        await connection.events()
    }

    public func attach(sessionId: String) async throws {
        do {
            try await connection.attach(sessionID: sessionId, afterSeq: 0)
        } catch {
            throw Self.failure(error, "The session could not be read.")
        }
    }

    public func detach(sessionId: String) async {
        try? await connection.detach(sessionID: sessionId)
    }

    public func send(sessionId: String, text: String) async throws -> String {
        let params = MessageSendParams(cwd: nil, sessionID: sessionId, skill: nil, stronger: nil, text: text)
        do {
            return try await connection.call("message.send", params, as: MessageSendResult.self).runID
        } catch {
            throw Self.failure(error, "The message did not reach your Mac.")
        }
    }

    public func cancel(runId: String) async throws {
        do {
            let _: RunCancelResult = try await connection.call("run.cancel", RunCancelParams(runID: runId))
        } catch {
            throw Self.failure(error, "The run could not be stopped.")
        }
    }

    public func create(folder: String?) async throws -> String {
        let params = SessionCreateParams(branch: nil, createBranch: false, cwd: folder, modelProfile: nil, origin: .user, planFirst: nil)
        do {
            return try await connection.call("session.create", params, as: SessionCreateResult.self).sessionID
        } catch {
            throw Self.failure(error, "The session could not be made.")
        }
    }

    private static func failure(_ error: Error, _ fallback: String) -> SessionFailure {
        switch error {
        case ConnectionError.notConnected, ConnectionError.timedOut: .failed("Your Mac is not reachable.")
        case ConnectionError.rpc(_, let message): .failed(message.isEmpty ? fallback : message)
        default: .failed(fallback)
        }
    }
}

public enum SessionLoad: Equatable, Sendable {
    case loading
    case ready
    case failed(String)
}

/// One session open on the phone. `run()` attaches it and folds its events until the task is cancelled,
/// then detaches. Reading the replay and reading live events are the same stream.
@MainActor @Observable
public final class SessionDetailModel {
    public let sessionID: String
    public let title: String
    public let transcript: TranscriptModel
    public private(set) var load: SessionLoad = .loading
    /// Why the last send or cancel failed.
    public private(set) var actionError: String?
    public private(set) var isSending = false
    /// What is typed in the composer. A failed send keeps it.
    public var draft = ""

    @ObservationIgnored private let channel: any SessionChannel

    public init(sessionID: String, title: String, channel: any SessionChannel) {
        self.sessionID = sessionID
        self.title = title
        self.channel = channel
        transcript = TranscriptModel(sessionID: sessionID)
    }

    public var chat: ChatState { transcript.chat }

    /// Attaches the session and follows it. Returns when the task is cancelled or the stream ends.
    public func run() async {
        let channel = channel
        let id = sessionID
        transcript.reset()
        load = .loading
        let events = await channel.events()
        let attach = Task { @MainActor [weak self] in
            do {
                try await channel.attach(sessionId: id)
                self?.load = .ready
            } catch let failure as SessionFailure {
                self?.load = .failed(failure.message)
            } catch {
                self?.load = .failed("The session could not be read.")
            }
        }
        await transcript.follow(events)
        attach.cancel()
        // A cancelled task cannot make the call itself.
        Task { await channel.detach(sessionId: id) }
    }

    /// Whether the composer may send.
    public var canSend: Bool {
        !isSending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Sends the draft as a reply. The reply shows when the Mac's events bring it back.
    public func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isSending, !text.isEmpty else { return }
        isSending = true
        actionError = nil
        defer { isSending = false }
        do {
            try await channel.send(sessionId: sessionID, text: text)
            draft = ""
        } catch let failure as SessionFailure {
            actionError = failure.message
        } catch {
            actionError = "The message did not reach your Mac."
        }
    }

    /// Stops the running turn.
    public func cancelRun() async {
        guard let runId = chat.runId else { return }
        actionError = nil
        do {
            try await channel.cancel(runId: runId)
        } catch let failure as SessionFailure {
            actionError = failure.message
        } catch {
            actionError = "The run could not be stopped."
        }
    }

    /// The last finished reply of golem, for reading full screen. Nil while a reply streams or there is none.
    public var result: ChatMessage? { lastResult(chat.messages) }

    /// A token that changes whenever the transcript grows, so a screen can follow the bottom.
    public var growth: Int {
        let last = chat.messages.last
        let tools = chat.messages.reduce(0) { $0 + ($1.tools?.count ?? 0) }
        return chat.messages.count * 1_000_003 + (last?.text.utf8.count ?? 0) * 31 + tools + (chat.busy ? 1 : 0)
    }
}

/// The newest finished assistant message that has text.
public func lastResult(_ messages: [ChatMessage]) -> ChatMessage? {
    guard let last = messages.last(where: { $0.role == .assistant && !$0.text.isEmpty }), !last.streaming else {
        return nil
    }
    return last
}

/// A message as styled text. Inline Markdown (bold, italic, code, links) is drawn; line breaks stay as
/// typed. Text that does not parse is shown as it is.
public func markdownText(_ text: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(
        interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
    return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
}

// MARK: - New task

/// The folders sessions ran in, newest first, each once.
public func recentFolders(_ sessions: [InboxSession], limit: Int = 8) -> [String] {
    let ordered = sessions.enumerated().sorted { left, right in
        let x = left.element.updatedAt.flatMap(parseTime) ?? -.infinity
        let y = right.element.updatedAt.flatMap(parseTime) ?? -.infinity
        return x == y ? left.offset < right.offset : x > y
    }
    var seen = Set<String>()
    var folders: [String] = []
    for entry in ordered {
        guard let cwd = entry.element.cwd, !cwd.isEmpty, seen.insert(cwd).inserted else { continue }
        folders.append(cwd)
        if folders.count == limit { break }
    }
    return folders
}

/// The new-task screen: a recent folder, the text, and Start.
@MainActor @Observable
public final class NewTaskModel: Identifiable {
    public let folders: [String]
    /// Nil is the Mac's default folder, which is also what an empty list offers.
    public var folder: String?
    public var text = ""
    public private(set) var isStarting = false
    public private(set) var error: String?

    @ObservationIgnored private let channel: any SessionChannel
    /// Set once the session exists, so a retry after a failed send does not make a second one.
    @ObservationIgnored private var createdID: String?

    public init(folders: [String], channel: any SessionChannel) {
        self.folders = folders
        folder = folders.first
        self.channel = channel
    }

    public var canStart: Bool {
        !isStarting && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Makes the session, sends the text, and returns the session's id. Nil when it failed: `error` says why.
    public func start() async -> String? {
        let task = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isStarting, !task.isEmpty else { return nil }
        isStarting = true
        error = nil
        defer { isStarting = false }
        do {
            let id: String
            if let createdID { id = createdID } else { id = try await channel.create(folder: folder) }
            createdID = id
            try await channel.send(sessionId: id, text: task)
            return id
        } catch let failure as SessionFailure {
            error = failure.message
        } catch {
            self.error = "The task did not start."
        }
        return nil
    }
}
