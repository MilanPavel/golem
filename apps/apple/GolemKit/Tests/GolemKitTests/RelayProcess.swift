import Foundation

/// The real relay (`packages/relay`, on Bun) as a subprocess on a free port.
final class RelayProcess {
    let port: Int
    private let process = Process()

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
        process.standardError = FileHandle.nullDevice
        try process.run()
    }

    func waitUntilHealthy() async throws {
        let health = URL(string: "http://127.0.0.1:\(port)/healthz")!
        for _ in 0..<200 {
            if let (_, response) = try? await URLSession.shared.data(from: health),
               (response as? HTTPURLResponse)?.statusCode == 200 {
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw RelayProcessError.notHealthy
    }

    func stop() {
        if process.isRunning { process.terminate() }
        process.waitUntilExit()
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
    case bunMissing, noPort, notHealthy
}
