import Foundation

/// The app's one connection to its Mac, through the relay (ADR-051).
///
/// It opens the relay's `/v1/device` WebSocket, proves the device key to the relay, runs the
/// Noise handshake with the Mac inside relay frames, proves the device key to the Mac inside the
/// channel, then carries JSON-RPC lines both ways. It follows sessions: after a reconnect it
/// attaches each again from the last `seq` seen, and drops events it already has.
///
/// Nothing here logs. The device key stays behind `DeviceKey`, and Noise keys live only inside a
/// handshake.
public actor Connection {
    private enum Outcome {
        case stop(StopReason)
        /// Reconnect after a delay. `state` is what the app shows meanwhile.
        case retry(ConnectionState, resetBackoff: Bool = false, longDelay: Bool = false)
    }

    private let config: ConnectionConfig
    private let key: any DeviceKey

    public private(set) var state: ConnectionState = .stopped(.stopped)
    private var stateSubscribers: [UUID: AsyncStream<ConnectionState>.Continuation] = [:]
    private var eventSubscribers: [UUID: AsyncStream<GolemEvent>.Continuation] = [:]
    private var outcomeSubscribers: [UUID: AsyncStream<OutboxOutcome>.Continuation] = [:]

    private var runTask: Task<Void, Never>?
    private var runID = 0
    private var socket: RelaySocket?
    private var forcedOutcome: Outcome?

    // One Noise session at a time, on one relay socket.
    private var sessionToken = 0
    private var sid: Data?
    private var initiator: NoiseInitiator?
    private var transport: NoiseTransport?
    private var assembler = LineAssembler()
    private var channelOpen = false
    private var heartbeat: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var reachedConnected = false

    private var nextID = 1
    private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
    private var timers: [Int: Task<Void, Never>] = [:]

    private var attachments = Attachments()
    private var outbox = Outbox()
    private var flushing = false

    public init(config: ConnectionConfig, key: any DeviceKey) {
        self.config = config
        self.key = key
    }

    // MARK: - Observing

    /// The state now, then every change.
    public func states() -> AsyncStream<ConnectionState> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<ConnectionState>.makeStream(bufferingPolicy: .unbounded)
        stateSubscribers[id] = continuation
        continuation.yield(state)
        continuation.onTermination = { [weak self] _ in
            Task { await self?.dropStateSubscriber(id) }
        }
        return stream
    }

    /// Events of the followed sessions, each once, in order, across reconnects.
    public func events() -> AsyncStream<GolemEvent> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<GolemEvent>.makeStream(bufferingPolicy: .unbounded)
        eventSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.dropEventSubscriber(id) }
        }
        return stream
    }

    /// What became of each queued request.
    public func outboxOutcomes() -> AsyncStream<OutboxOutcome> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<OutboxOutcome>.makeStream(bufferingPolicy: .unbounded)
        outcomeSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.dropOutcomeSubscriber(id) }
        }
        return stream
    }

    private func dropStateSubscriber(_ id: UUID) { stateSubscribers[id] = nil }
    private func dropEventSubscriber(_ id: UUID) { eventSubscribers[id] = nil }
    private func dropOutcomeSubscriber(_ id: UUID) { outcomeSubscribers[id] = nil }

    private func setState(_ next: ConnectionState) {
        guard next != state else { return }
        state = next
        for continuation in stateSubscribers.values { continuation.yield(next) }
    }

    // MARK: - Lifecycle

    /// Starts connecting, and keeps the link up until `stop()` or a reason to stop by itself.
    public func start() {
        guard runTask == nil else { return }
        runID += 1
        let id = runID
        setState(.connecting)
        runTask = Task { await self.run(id: id) }
    }

    /// Closes the link and stops retrying. Followed sessions and the outbox are kept, so a later
    /// `start()` resumes.
    public func stop() {
        runTask?.cancel()
        runTask = nil
        runID += 1
        forcedOutcome = .stop(.stopped)
        socket?.close()
        socket = nil
        endSession()
        setState(.stopped(.stopped))
    }

    /// Drops the relay socket as a network failure would. For tests.
    func forceDisconnect() {
        socket?.close()
    }

    private func run(id: Int) async {
        var attempt = 0
        while !Task.isCancelled, id == runID {
            let outcome = await connectOnce(id: id)
            guard !Task.isCancelled, id == runID else { return }
            switch outcome {
            case .stop(let reason):
                runTask = nil
                setState(.stopped(reason))
                return
            case .retry(let shown, let reset, let longDelay):
                setState(shown)
                attempt = reset ? 1 : attempt + 1
                if longDelay { attempt = max(attempt, 20) }
                let seconds = config.timing.delay(attempt: attempt)
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                guard !Task.isCancelled, id == runID else { return }
                setState(.connecting)
            }
        }
    }

    // MARK: - One relay socket

    private func connectOnce(id: Int) async -> Outcome {
        let socket = RelaySocket(url: config.endpoint)
        self.socket = socket
        forcedOutcome = nil
        reachedConnected = false
        let age = Task { [config] in
            try? await Task.sleep(nanoseconds: UInt64(config.timing.maxAge * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self.expire(socket)
        }
        defer {
            age.cancel()
            socket.close()
            if self.socket === socket { self.socket = nil }
            endSession()
        }
        do {
            try await login(socket)
            while true {
                switch try await socket.receive() {
                case .text(let text): try handleControl(text)
                case .binary(let data): try handleFrame(data)
                }
            }
        } catch let error as RelaySocketError {
            if let forced = takeForcedOutcome() { return forced }
            guard case .closed(let code) = error else { return .retry(.relayUnreachable) }
            return Self.outcome(forCloseCode: code, wasConnected: reachedConnected)
        } catch let stop as StopSignal {
            return stop.outcome
        } catch {
            if let forced = takeForcedOutcome() { return forced }
            // A frame that does not open, or a message out of order: this session is no good.
            return .retry(.connecting, resetBackoff: reachedConnected)
        }
    }

    private func takeForcedOutcome() -> Outcome? {
        defer { forcedOutcome = nil }
        return forcedOutcome
    }

    private func expire(_ socket: RelaySocket) {
        guard self.socket === socket else { return }
        forcedOutcome = .retry(.connecting, resetBackoff: true)
        socket.close()
    }

    private static func outcome(forCloseCode code: Int?, wasConnected: Bool) -> Outcome {
        switch code {
        case RelayClose.notAuthenticated: return .stop(.pairAgain)
        case RelayClose.revoked: return .stop(.revoked)
        case RelayClose.replaced: return .stop(.replaced)
        case RelayClose.badMessage, RelayClose.tooBig: return .retry(.relayUnreachable, longDelay: true)
        default: return .retry(.relayUnreachable, resetBackoff: wasConnected)
        }
    }

    /// Ends the read loop from inside a handler, with the outcome to report.
    private struct StopSignal: Error {
        let outcome: Outcome
    }

    /// Answers the relay's challenge with the device key.
    private func login(_ socket: RelaySocket) async throws {
        guard case .text(let text) = try await socket.receive(),
              let challenge = Self.object(text), challenge["type"] as? String == "challenge",
              challenge["v"] as? Int == RelayWire.protocolVersion,
              let nonce = challenge["nonce"] as? String
        else { throw StopSignal(outcome: .retry(.relayUnreachable, longDelay: true)) }
        let signature: Data
        do {
            signature = try key.sign(RelayWire.authMessage(host: config.relayHost, nonce: nonce))
        } catch {
            throw StopSignal(outcome: .stop(.incompatible("the device key cannot sign")))
        }
        let message: [String: Any] = [
            "type": "auth",
            "v": RelayWire.protocolVersion,
            "key": Base64URL.encode(key.publicKey),
            "sig": Base64URL.encode(signature),
            "mac": Base64URL.encode(config.roomID),
        ]
        socket.send(text: Self.json(message))
    }

    // MARK: - Relay control messages

    private func handleControl(_ text: String) throws {
        guard let message = Self.object(text), let type = message["type"] as? String else { return }
        switch (type, message["state"] as? String) {
        case ("peer", "online"?):
            try startHandshake()
        case ("peer", "offline"?):
            endSession()
            setState(.macUnreachable)
        default:
            // An `error` precedes a close, which the loop sees next. Anything else is not for us.
            break
        }
    }

    // MARK: - The handshake

    private func startHandshake() throws {
        endSession()
        let sid = Data((0..<RelayWire.sidBytes).map { _ in UInt8.random(in: 0...255) })
        var initiator = NoiseInitiator(
            prologue: RelayWire.prologue(roomID: config.roomID), remoteStatic: config.macNoiseKey)
        let first = try initiator.writeMessage1()
        self.sid = sid
        self.initiator = initiator
        setState(.connecting)
        sendFrame(RelayWire.frame(sid: sid, noise: first))
        let token = sessionToken
        let timeout = config.timing.linkTimeout
        watchdog = Task {
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self.handshakeTimedOut(token)
        }
    }

    /// The Mac is online by the relay's word but did not finish the session in time.
    private func handshakeTimedOut(_ token: Int) {
        guard token == sessionToken, !channelOpen else { return }
        forcedOutcome = .retry(.macUnreachable)
        socket?.close()
    }

    private func endSession() {
        sessionToken += 1
        sid = nil
        initiator = nil
        transport = nil
        assembler = LineAssembler()
        channelOpen = false
        heartbeat?.cancel()
        heartbeat = nil
        watchdog?.cancel()
        watchdog = nil
        failPending(ConnectionError.notConnected)
    }

    // MARK: - Frames in the channel

    private func handleFrame(_ data: Data) throws {
        guard let frame = RelayWire.parseFrame(data), frame.sid == sid else { return }
        if initiator != nil {
            guard let (_, ready) = try initiator?.readMessage2(frame.noise) else { return }
            initiator = nil
            transport = ready
            try sendDeviceAuth(handshakeHash: ready.handshakeHash)
            return
        }
        guard transport != nil, let plain = try transport?.decrypt(frame.noise) else { return }
        guard let (type, body) = try assembler.feed(plain) else { return }
        switch type {
        case .control: try handleChannelControl(body)
        case .line: handleLine(body)
        }
    }

    /// The device proves itself to the Mac: its key and a signature over `"golem-auth-v1" || h`.
    private func sendDeviceAuth(handshakeHash: Data) throws {
        let signature: Data
        do {
            signature = try key.sign(RelayWire.channelAuthMessage(handshakeHash: handshakeHash))
        } catch {
            throw StopSignal(outcome: .stop(.incompatible("the device key cannot sign")))
        }
        let body: [String: Any] = [
            "type": "auth",
            "v": RelayWire.protocolVersion,
            "key": Base64URL.encode(key.publicKey),
            "sig": Base64URL.encode(signature),
        ]
        try sendChannel(.control, Data(Self.json(body).utf8))
    }

    private func handleChannelControl(_ body: Data) throws {
        guard let message = Self.object(String(decoding: body, as: UTF8.self)),
              let type = message["type"] as? String
        else { return }
        switch type {
        case "ok":
            guard !channelOpen else { return }
            channelOpen = true
            watchdog?.cancel()
            watchdog = nil
            let token = sessionToken
            Task { await self.afterOpen(token: token) }
        case "error":
            switch message["code"] as? String {
            case "unknown_device": throw StopSignal(outcome: .stop(.pairAgain))
            case "revoked": throw StopSignal(outcome: .stop(.revoked))
            case "daemon_unavailable": throw StopSignal(outcome: .retry(.macUnreachable))
            default: throw StopSignal(outcome: .retry(.relayUnreachable, longDelay: true))
            }
        default:
            // `push.key` and the other control messages belong to later tickets.
            break
        }
    }

    // MARK: - After `ok`: hello, resume, outbox

    private func afterOpen(token: Int) async {
        do {
            let timeout = config.timing.linkTimeout
            let params = try JSONEncoder().encode(HelloParams.current(client: config.clientName))
            let reply = try await request("hello", params: params, timeout: timeout)
            let hello = try JSONDecoder().decode(HelloResult.self, from: reply)
            do {
                try hello.check()
            } catch {
                guard token == sessionToken else { return }
                forcedOutcome = .stop(.incompatible("the Mac speaks protocol \(hello.protocolMajor)"))
                socket?.close()
                return
            }
            for (sessionID, afterSeq) in attachments.entries() {
                guard token == sessionToken else { return }
                let params = try JSONEncoder().encode(SessionAttachParams(afterSeq: afterSeq, sessionID: sessionID))
                do {
                    _ = try await request("session.attach", params: params, timeout: nil)
                } catch ConnectionError.rpc(let code, _) where code == Self.sessionNotFound {
                    attachments.untrack(sessionID)
                }
            }
            guard token == sessionToken else { return }
            reachedConnected = true
            setState(.connected)
            startHeartbeat(token: token)
            flushOutbox()
        } catch {
            guard token == sessionToken else { return }
            // A dead or confused link: close it and let the loop reconnect.
            socket?.close()
        }
    }

    private static let sessionNotFound = -32003

    private func startHeartbeat(token: Int) {
        let interval = config.timing.pingInterval
        let timeout = config.timing.linkTimeout
        heartbeat = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard !Task.isCancelled else { return }
                do {
                    _ = try await self.heartbeatPing(token: token, timeout: timeout)
                } catch {
                    await self.linkDied(token: token)
                    return
                }
            }
        }
    }

    private func heartbeatPing(token: Int, timeout: Double) async throws -> Data {
        guard token == sessionToken else { throw ConnectionError.notConnected }
        return try await request("ping", params: nil, timeout: timeout)
    }

    private func linkDied(token: Int) {
        guard token == sessionToken else { return }
        forcedOutcome = .retry(.relayUnreachable)
        socket?.close()
    }

    // MARK: - JSON-RPC

    /// Calls a method the app may call, and returns the `result` as JSON.
    public func callRaw(_ method: String, params: Data? = nil) async throws -> Data {
        guard MethodAccess.appMayCall(method) else { throw ConnectionError.methodNotAllowed(method) }
        guard state == .connected else { throw ConnectionError.notConnected }
        return try await request(method, params: params, timeout: nil)
    }

    /// Calls a method with typed params and result.
    public func call<Params: Encodable, Result: Decodable>(
        _ method: String, _ params: Params, as: Result.Type = Result.self
    ) async throws -> Result {
        let reply = try await callRaw(method, params: try JSONEncoder().encode(params))
        do {
            return try JSONDecoder().decode(Result.self, from: reply)
        } catch {
            throw ConnectionError.invalidResponse
        }
    }

    /// The Mac's sessions.
    public func listSessions() async throws -> [SessionElement] {
        let params = SessionListParams(cwd: nil, limit: nil, watch: nil)
        return try await call("session.list", params, as: SessionListResult.self).sessions
    }

    /// Follows a session: replays what came after `afterSeq`, then streams live events. After a
    /// reconnect the connection attaches again from the last `seq` it delivered.
    @discardableResult
    public func attach(sessionID: String, afterSeq: Int = 0) async throws -> SessionAttachResult {
        let followed = attachments.seen(sessionID) != nil
        attachments.track(sessionID, afterSeq: afterSeq)
        do {
            let params = SessionAttachParams(afterSeq: attachments.seen(sessionID), sessionID: sessionID)
            return try await call("session.attach", params, as: SessionAttachResult.self)
        } catch {
            if !followed { attachments.untrack(sessionID) }
            throw error
        }
    }

    /// Stops following a session.
    public func detach(sessionID: String) async throws {
        attachments.untrack(sessionID)
        struct Params: Encodable { let sessionID: String
            enum CodingKeys: String, CodingKey { case sessionID = "session_id" }
        }
        _ = try await callRaw("session.detach", params: try JSONEncoder().encode(Params(sessionID: sessionID)))
    }

    /// The newest `seq` delivered for a followed session.
    public func lastSeq(sessionID: String) -> Int? {
        attachments.seen(sessionID)
    }

    private func request(_ method: String, params: Data?, timeout: Double?) async throws -> Data {
        guard channelOpen, transport != nil else { throw ConnectionError.notConnected }
        let id = nextID
        nextID += 1
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            var message: [String: Any] = ["jsonrpc": "2.0", "id": id, "method": method]
            if let params, let object = try? JSONSerialization.jsonObject(with: params, options: [.fragmentsAllowed]) {
                message["params"] = object
            }
            do {
                try sendChannel(.line, Data(Self.json(message).utf8))
            } catch {
                pending[id] = nil
                continuation.resume(throwing: error)
                return
            }
            if let timeout {
                timers[id] = Task {
                    try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                    guard !Task.isCancelled else { return }
                    await self.timeOut(id)
                }
            }
        }
    }

    private func timeOut(_ id: Int) {
        timers[id] = nil
        pending.removeValue(forKey: id)?.resume(throwing: ConnectionError.timedOut)
    }

    private func failPending(_ error: Error) {
        let waiting = pending
        pending = [:]
        for timer in timers.values { timer.cancel() }
        timers = [:]
        for continuation in waiting.values { continuation.resume(throwing: error) }
    }

    /// One protocol line from the Mac: a response, or a notification.
    private func handleLine(_ body: Data) {
        guard let message = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return }
        if let id = message["id"] as? Int, message["method"] == nil {
            timers.removeValue(forKey: id)?.cancel()
            guard let continuation = pending.removeValue(forKey: id) else { return }
            if let error = message["error"] as? [String: Any] {
                let code = error["code"] as? Int ?? 0
                continuation.resume(throwing: ConnectionError.rpc(code: code, message: error["message"] as? String ?? ""))
            } else if let result = message["result"],
                      let data = try? JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed]) {
                continuation.resume(returning: data)
            } else {
                continuation.resume(throwing: ConnectionError.invalidResponse)
            }
            return
        }
        if message["method"] as? String == "event", let params = message["params"] as? [String: Any] {
            deliver(params)
        }
    }

    /// An event of a session. A followed session's event at or below its last `seq` is a repeat
    /// from a replay and is dropped.
    private func deliver(_ params: [String: Any]) {
        if let sessionID = params["session_id"] as? String, let seq = params["seq"] as? Int,
           !attachments.accept(sessionID: sessionID, seq: seq) {
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: params),
              let event = try? JSONDecoder().decode(GolemEvent.self, from: data)
        else { return }
        for continuation in eventSubscribers.values { continuation.yield(event) }
    }

    // MARK: - Sending

    private func sendChannel(_ type: ChannelType, _ body: Data) throws {
        guard let sid, transport != nil else { throw ConnectionError.notConnected }
        if type == .line, body.count > RelayWire.maxLineBytes { throw ConnectionError.invalidResponse }
        // Encrypt and queue each piece in one step, so nonces and frames stay in the same order.
        for piece in ChannelCodec.pieces(type: type, body: body) {
            guard let sealed = try transport?.encrypt(piece) else { throw ConnectionError.notConnected }
            sendFrame(RelayWire.frame(sid: sid, noise: sealed))
        }
    }

    private func sendFrame(_ frame: Data) {
        socket?.send(data: frame)
    }

    // MARK: - Outbox

    /// Queues an answer. It goes out at once when the link is up, and after the next reconnect
    /// when not. `outboxOutcomes()` reports what the Mac said.
    @discardableResult
    public func enqueue<Params: Encodable>(_ method: String, _ params: Params) throws -> UUID {
        guard MethodAccess.appMayCall(method) else { throw ConnectionError.methodNotAllowed(method) }
        let id = try outbox.add(method: method, params: try JSONEncoder().encode(params))
        flushOutbox()
        return id
    }

    /// How many answers wait to be delivered.
    public var outboxCount: Int { outbox.count }

    private func flushOutbox() {
        guard state == .connected, !flushing else { return }
        let ready = outbox.takeReady()
        guard !ready.isEmpty else { return }
        flushing = true
        Task { await self.deliverOutbox(ready) }
    }

    private func deliverOutbox(_ entries: [Outbox.Entry]) async {
        for (index, entry) in entries.enumerated() {
            do {
                _ = try await request(entry.method, params: entry.params, timeout: nil)
                finish(entry, .delivered)
            } catch ConnectionError.rpc(let code, let message) {
                finish(entry, .rejected(code: code, message: message))
            } catch {
                // The link dropped. This one and the rest wait for the next session.
                for rest in entries[index...] { outbox.release(rest.id) }
                break
            }
        }
        flushing = false
        flushOutbox()
    }

    private func finish(_ entry: Outbox.Entry, _ result: OutboxOutcome.Result) {
        outbox.remove(entry.id)
        let outcome = OutboxOutcome(id: entry.id, method: entry.method, result: result)
        for continuation in outcomeSubscribers.values { continuation.yield(outcome) }
    }

    // MARK: - JSON helpers

    private static func object(_ text: String) -> [String: Any]? {
        try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
    }

    private static func json(_ object: [String: Any]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}
