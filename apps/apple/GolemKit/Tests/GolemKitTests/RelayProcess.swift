import Foundation

/// The real relay (`packages/relay`, on Bun) as a subprocess on a free port.
final class RelayProcess {
    let port: Int
    private let process = Process()
    private let errorPipe = Pipe()
    private let exited = ExitFlag()

    /// Where `bun` is, or nil when it is not installed. Tests that need the relay are skipped then.
    static let bunPath: String? = {
        var folders = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        folders += [NSHomeDirectory() + "/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin"]
        return folders.map { $0 + "/bun" }.first { FileManager.default.isExecutableFile(atPath: $0) }
    }()

    var url: URL { URL(string: "ws://127.0.0.1:\(port)")! }

    init() throws {
        guard let bun = Self.bunPath else { throw RelayProcessError.bunMissing }
        port = try Self.freePort()
        process.executableURL = URL(fileURLWithPath: bun)
        process.arguments = ["packages/relay/src/bun/main.ts"]
        process.currentDirectoryURL = repoRoot
        var environment = ProcessInfo.processInfo.environment
        environment["RELAY_HOST"] = "127.0.0.1"
        environment["BIND"] = "127.0.0.1:\(port)"
        // Many short connections come from one address.
        environment["IP_PER_MINUTE"] = "100000"
        environment["IP_OPEN"] = "1000"
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errorPipe
        let flag = exited
        process.terminationHandler = { _ in flag.set() }
        try process.run()
    }

    /// What the relay printed to stderr so far (only what is already buffered).
    private func stderrText() -> String {
        let fd = errorPipe.fileHandleForReading.fileDescriptor
        let flags = fcntl(fd, F_GETFL)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = read(fd, &buffer, buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return String(decoding: data, as: UTF8.self)
    }

    /// Waits for the relay to answer `/healthz`, for at most `seconds`. Fails with the relay's stderr.
    func waitUntilHealthy(seconds: Double = 10) async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/healthz")!)
        request.timeoutInterval = 2
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if exited.isSet { break }
            if let (_, response) = try? await URLSession.shared.data(for: request),
               (response as? HTTPURLResponse)?.statusCode == 200 {
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let output = stderrText()
        let died = exited.isSet
        stop()
        throw RelayProcessError.notHealthy(died ? "the relay exited: \(output)" : "no answer in \(seconds) s: \(output)")
    }

    /// Ends the relay and never blocks for long: `Process.waitUntilExit` can wait forever on a
    /// cooperative thread (#1556), so this watches the termination handler and falls back to SIGKILL.
    func stop() {
        guard process.processIdentifier > 0, !exited.isSet else { return }
        process.terminate()
        if !exited.wait(seconds: 2) {
            kill(process.processIdentifier, SIGKILL)
            _ = exited.wait(seconds: 2)
        }
    }

    private static func freePort() throws -> Int {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw RelayProcessError.noPort }
        defer { close(fd) }
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        address.sin_port = 0
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else { throw RelayProcessError.noPort }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) }
        }
        guard named == 0 else { throw RelayProcessError.noPort }
        return Int(UInt16(bigEndian: address.sin_port))
    }
}

enum RelayProcessError: Error {
    case bunMissing, noPort, notHealthy(String)
}

/// Set once the relay process has exited.
final class ExitFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false

    var isSet: Bool { lock.lock(); defer { lock.unlock() }; return value }
    func set() { lock.lock(); value = true; lock.unlock() }

    func wait(seconds: Double) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if isSet { return true }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return isSet
    }
}
