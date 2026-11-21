import Foundation

enum RelayIncoming {
    case text(String)
    case binary(Data)
}

enum RelaySocketError: Error {
    /// The socket ended. `code` is the WebSocket close code the relay sent, or nil when the
    /// link broke without one (the relay was not reachable, or the network dropped).
    case closed(code: Int?)
}

/// One WebSocket to the relay, on `URLSessionWebSocketTask`.
final class RelaySocket: @unchecked Sendable {
    private let task: URLSessionWebSocketTask
    private let session: URLSession
    private let lock = NSLock()
    private var closeCode: Int?
    private var finished = false

    init(url: URL) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.waitsForConnectivity = false
        let delegate = DelegateBox()
        session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        task = session.webSocketTask(with: url)
        // Frames are at most 32 KiB; control messages 16 KiB.
        task.maximumMessageSize = 1024 * 1024
        delegate.owner = self
        task.resume()
    }

    fileprivate func didClose(code: Int) {
        lock.lock()
        closeCode = code
        lock.unlock()
    }

    private var recordedCode: Int? {
        lock.lock()
        defer { lock.unlock() }
        if let closeCode { return closeCode }
        let raw = task.closeCode.rawValue
        return raw == 0 ? nil : raw
    }

    func receive() async throws -> RelayIncoming {
        do {
            switch try await task.receive() {
            case .string(let text): return .text(text)
            case .data(let data): return .binary(data)
            @unknown default: throw RelaySocketError.closed(code: nil)
            }
        } catch {
            // The close frame's code is set by the time the read fails; give the delegate a beat.
            try? await Task.sleep(nanoseconds: 20_000_000)
            throw RelaySocketError.closed(code: recordedCode)
        }
    }

    /// Queues a frame. Order is kept: URLSession sends in the order of the calls.
    func send(text: String) {
        task.send(.string(text)) { _ in }
    }

    func send(data: Data) {
        task.send(.data(data)) { _ in }
    }

    func close() {
        lock.lock()
        if finished {
            lock.unlock()
            return
        }
        finished = true
        lock.unlock()
        task.cancel(with: .normalClosure, reason: nil)
        session.invalidateAndCancel()
    }
}

/// Keeps the delegate from retaining the socket in a cycle.
private final class DelegateBox: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    weak var owner: RelaySocket?

    func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
    ) {
        owner?.didClose(code: closeCode.rawValue)
    }
}
