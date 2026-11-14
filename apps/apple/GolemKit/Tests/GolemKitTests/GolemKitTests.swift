import Foundation
import Testing
@testable import GolemKit

/// `packages/view/fixtures/golden`, recorded by `just golden`.
private let goldenFolder: URL = {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<6 { url.deleteLastPathComponent() }
    return url.appendingPathComponent("packages/view/fixtures/golden")
}()

private struct Fixture: Decodable {
    let live: [GolemEvent]
    let replay: [GolemEvent]
}

@Test func everyRecordedEventDecodes() throws {
    let files = try FileManager.default.contentsOfDirectory(at: goldenFolder, includingPropertiesForKeys: nil)
        .filter { $0.pathExtension == "json" }
    #expect(files.count == 5)
    for file in files {
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: file))
        #expect(!fixture.live.isEmpty, "\(file.lastPathComponent)")
        #expect(!fixture.replay.isEmpty, "\(file.lastPathComponent)")
        for event in fixture.live + fixture.replay {
            if case .unknown(let unknown) = event {
                Issue.record("\(file.lastPathComponent): \(unknown.type) decoded to the fallback")
            }
        }
        let seqs = fixture.live.compactMap(\.seq)
        #expect(seqs == seqs.sorted(), "\(file.lastPathComponent)")
    }
}

@Test func anUnknownEventTypeDecodesToTheFallback() throws {
    let json = #"{"type":"future.thing","seq":7,"session_id":"s","run_id":null,"ts":"t","data":{"x":1}}"#
    let event = try JSONDecoder().decode(GolemEvent.self, from: Data(json.utf8))
    guard case .unknown(let unknown) = event else {
        Issue.record("expected .unknown")
        return
    }
    #expect(unknown.type == "future.thing")
    #expect(event.seq == 7)
}

@Test func approvalRespondEncodesAllowAlways() throws {
    let params = ApprovalRespondParams(args: nil, callID: "c1", decision: .allowAlways, sessionID: "s1")
    let json = String(decoding: try JSONEncoder().encode(params), as: UTF8.self)
    #expect(json.contains(#""decision":"allow_always""#), "\(json)")
    #expect(json.contains(#""call_id":"c1""#), "\(json)")
    #expect(json.contains(#""session_id":"s1""#), "\(json)")
}

@Test func helloChecksTheProtocolMajor() throws {
    #expect(HelloParams.current(client: "ios").protocolMajor == ProtocolVersion.major)
    let newer = HelloResult(daemonVersion: "x", protocolMajor: ProtocolVersion.major, protocolMinor: ProtocolVersion.minor + 5)
    try newer.check()
    let other = HelloResult(daemonVersion: "x", protocolMajor: ProtocolVersion.major + 1, protocolMinor: 0)
    #expect(throws: HelloError.majorMismatch(app: ProtocolVersion.major, daemon: ProtocolVersion.major + 1)) {
        try other.check()
    }
}

@Test func theAppMayCallBrowserMethodsOnly() {
    #expect(MethodAccess.appMayCall("approval.respond"))
    #expect(!MethodAccess.appMayCall("auth.set"))
    #expect(!MethodAccess.appMayCall("nope"))
}
