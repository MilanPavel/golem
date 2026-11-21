import Network

/// Whether the phone has a network. The system's path monitor, as a stream.
enum NetworkMonitor {
    static func updates() -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { continuation.yield($0.status == .satisfied) }
            continuation.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: DispatchQueue(label: "golem.network"))
        }
    }
}
