import Foundation
import Testing
@testable import GolemKit

private final class FakeAuthenticator: ApprovalAuthenticator, @unchecked Sendable {
    let available: Bool
    let passes: Bool
    private let lock = NSLock()
    private var reasonsAsked: [String] = []

    init(available: Bool = true, passes: Bool = true) {
        self.available = available
        self.passes = passes
    }

    var reasons: [String] { lock.withLock { reasonsAsked } }
    func isAvailable() -> Bool { available }
    func confirm(reason: String) async -> Bool {
        lock.withLock { reasonsAsked.append(reason) }
        return passes
    }
}

private final class FakeChannel: ApprovalChannel, @unchecked Sendable {
    struct Sent: Equatable {
        var sessionId: String
        var callId: String
        var decision: Decision
    }

    private let lock = NSLock()
    private var log: [Sent] = []
    var failure: ApprovalFailure?
    private let stream: AsyncStream<ApprovalResolution>
    private let feed: AsyncStream<ApprovalResolution>.Continuation

    init(failure: ApprovalFailure? = nil) {
        self.failure = failure
        (stream, feed) = AsyncStream.makeStream()
    }

    var sent: [Sent] { lock.withLock { log } }
    func respond(sessionId: String, callId: String, decision: Decision) async throws {
        if let failure { throw failure }
        lock.withLock { log.append(Sent(sessionId: sessionId, callId: callId, decision: decision)) }
    }
    func resolutions() -> AsyncStream<ApprovalResolution> { stream }
    func resolve(_ resolution: ApprovalResolution) { feed.yield(resolution) }
}

private func request(
    name: String, args: String = "{}", folder: String? = "/Users/me/code/shop", diff: String? = nil
) -> ApprovalRequest {
    guard case .ok(let parsed) = parseArgs(args) else { fatalError("bad args in the test") }
    let pending = PendingApproval(callId: "c1", name: name, args: parsed, source: "built-in default", diff: diff)
    return ApprovalRequest(pending: pending, sessionId: "s1", origin: "NPE in checkout", folder: folder)
}

@MainActor
private func model(
    _ request: ApprovalRequest, authenticator: FakeAuthenticator = .init(), channel: FakeChannel = .init()
) -> ApprovalSheetModel {
    ApprovalSheetModel(request: request, deviceName: "iPhone 16", authenticator: authenticator, channel: channel)
}

@Suite struct RiskyToolTests {
    @Test func shellIsRisky() {
        #expect(isRiskyApproval(request(name: "shell", args: #"{"command":"ls"}"#)))
        #expect(isRiskyApproval(request(name: "shell_unsandboxed", args: #"{"command":"ls"}"#)))
    }

    @Test func theReadsAreNotRisky() {
        for name in ["read_file", "list_dir", "glob", "grep", "git_status", "git_diff", "git_log", "web_fetch",
            "web_search", "read_artifact", "todo_write"]
        {
            #expect(!isRiskyApproval(request(name: name)), "\(name)")
        }
    }

    @Test func aFileWriteInsideTheFolderIsNotRisky() {
        #expect(!isRiskyApproval(request(name: "write_file", args: #"{"path":"src/a.ts"}"#)))
        #expect(!isRiskyApproval(request(name: "edit_file", args: #"{"path":"/Users/me/code/shop/src/a.ts"}"#)))
    }

    @Test func aFileWriteOutsideTheFolderIsRisky() {
        #expect(isRiskyApproval(request(name: "write_file", args: #"{"path":"/etc/hosts"}"#)))
        #expect(isRiskyApproval(request(name: "edit_file", args: #"{"path":"../other/a.ts"}"#)))
        #expect(isRiskyApproval(request(name: "edit_file", args: #"{"path":"src/../../x"}"#)))
        #expect(isRiskyApproval(request(name: "write_file", args: #"{"path":"~/notes.md"}"#)))
        // A sibling folder that starts with the same letters is not inside.
        #expect(isRiskyApproval(request(name: "write_file", args: #"{"path":"/Users/me/code/shop-old/a"}"#)))
    }

    @Test func aFileWriteWithNoFolderOrPathIsRisky() {
        #expect(isRiskyApproval(request(name: "write_file", args: #"{"path":"a.ts"}"#, folder: nil)))
        #expect(isRiskyApproval(request(name: "write_file")))
    }

    @Test func anMcpToolIsRiskyUnlessItsServerMarksItReadOnly() {
        var mcp = request(name: "mcp__linear__create_issue")
        #expect(isRiskyApproval(mcp))
        mcp.mcpReadOnly = false
        #expect(isRiskyApproval(mcp))
        mcp.mcpReadOnly = true
        #expect(!isRiskyApproval(mcp))
    }

    @Test func aToolTheAppDoesNotKnowIsRisky() {
        #expect(isRiskyApproval(request(name: "teleport")))
    }
}

@Suite struct ApprovalRequestTests {
    @Test func aShellCallShowsItsCommandAndTheRuleItWillWrite() {
        let shell = request(name: "shell", args: #"{"command":"git status"}"#)
        #expect(shell.detail == "git status")
        #expect(alwaysAllowRuleText(shell) == "shell(git status)")
        #expect(alwaysAllowNote(shell, deviceName: "iPhone 16").contains("marked from iPhone 16"))
        #expect(alwaysAllowNote(shell, deviceName: "iPhone 16").contains("in /Users/me/code/shop"))
    }

    @Test func aDiffIsShownForAFileEdit() {
        let edit = request(name: "edit_file", args: #"{"path":"src/a.ts"}"#, diff: "-a\n+b")
        #expect(edit.detail == "-a\n+b")
        #expect(edit.path == "src/a.ts")
    }

    @Test func anMcpRuleNamesTheToolOnly() {
        let mcp = request(name: "mcp__linear__create_issue", args: #"{"title":"NPE"}"#)
        #expect(alwaysAllowRuleText(mcp) == "mcp__linear__create_issue")
        #expect(mcp.detail.contains("\"title\""))
    }
}

@MainActor
@Suite struct ApprovalSheetModelTests {
    @Test func denyNeverAsksForFaceID() async {
        let auth = FakeAuthenticator()
        let channel = FakeChannel()
        let sheet = model(request(name: "shell", args: #"{"command":"rm -rf x"}"#), authenticator: auth, channel: channel)
        await sheet.deny()
        #expect(auth.reasons.isEmpty)
        #expect(channel.sent == [.init(sessionId: "s1", callId: "c1", decision: .deny)])
        #expect(sheet.phase == .answered(.deny))
        #expect(sheet.closingText == "Denied")
    }

    @Test func allowOnceOfAReadAsksForNothing() async {
        let auth = FakeAuthenticator()
        let channel = FakeChannel()
        let sheet = model(request(name: "read_file", args: #"{"path":"a"}"#), authenticator: auth, channel: channel)
        await sheet.allowOnce()
        #expect(auth.reasons.isEmpty)
        #expect(channel.sent.map(\.decision) == [.allow])
    }

    @Test func allowOnceOfARiskyToolNeedsFaceID() async {
        let auth = FakeAuthenticator(passes: false)
        let channel = FakeChannel()
        let sheet = model(request(name: "shell", args: #"{"command":"ls"}"#), authenticator: auth, channel: channel)
        await sheet.allowOnce()
        #expect(auth.reasons.count == 1)
        #expect(channel.sent.isEmpty)
        #expect(sheet.phase == .ready)
        #expect(sheet.confirmNote != nil)

        let passing = FakeAuthenticator()
        let second = model(request(name: "shell", args: #"{"command":"ls"}"#), authenticator: passing, channel: channel)
        await second.allowOnce()
        #expect(channel.sent.map(\.decision) == [.allow])
    }

    @Test func alwaysAllowNeedsFaceIDForEveryTool() async {
        let auth = FakeAuthenticator(passes: false)
        let channel = FakeChannel()
        let sheet = model(request(name: "read_file", args: #"{"path":"a"}"#), authenticator: auth, channel: channel)
        await sheet.alwaysAllow()
        #expect(auth.reasons.count == 1)
        #expect(auth.reasons[0].contains("read_file"))
        #expect(channel.sent.isEmpty)

        let passing = FakeAuthenticator()
        let second = model(request(name: "read_file", args: #"{"path":"a"}"#), authenticator: passing, channel: channel)
        await second.alwaysAllow()
        #expect(passing.reasons.count == 1)
        #expect(channel.sent.map(\.decision) == [.allowAlways])
        #expect(second.closingText == "Always allowed")
    }

    @Test func aPhoneWithNoFaceIDOrPasscodeHidesTheProofButtons() async {
        let auth = FakeAuthenticator(available: false)
        let risky = model(request(name: "shell", args: #"{"command":"ls"}"#), authenticator: auth)
        #expect(!risky.showsAlwaysAllow)
        #expect(!risky.showsAllowOnce)
        let safe = model(request(name: "read_file", args: #"{"path":"a"}"#), authenticator: auth)
        #expect(!safe.showsAlwaysAllow)
        #expect(safe.showsAllowOnce)

        // Even if called, nothing is sent.
        let channel = FakeChannel()
        let again = model(request(name: "shell", args: #"{"command":"ls"}"#), authenticator: auth, channel: channel)
        await again.alwaysAllow()
        #expect(channel.sent.isEmpty)
        #expect(again.phase != .answered(.allowAlways))
    }

    @Test func anAnswerGivenOnTheMacClosesTheSheetWithThatMessage() async throws {
        let channel = FakeChannel()
        let sheet = model(request(name: "read_file"), channel: channel)
        sheet.follow()
        // Another call's answer changes nothing.
        channel.resolve(.init(sessionId: "s1", callId: "other", decision: .allow, device: nil))
        channel.resolve(.init(sessionId: "s1", callId: "c1", decision: .deny, device: nil))
        for _ in 0..<100 where !sheet.isClosing { try await Task.sleep(nanoseconds: 10_000_000) }
        #expect(sheet.phase == .answeredElsewhere)
        #expect(sheet.closingText == "Answered on the Mac")
        sheet.stopFollowing()
    }

    @Test func aCallThatNoRunWaitsOnAnyMoreIsAnsweredElsewhere() async {
        let channel = FakeChannel(failure: .alreadyAnswered)
        let sheet = model(request(name: "read_file"), channel: channel)
        await sheet.allowOnce()
        #expect(sheet.phase == .answeredElsewhere)
    }

    @Test func aFailedAnswerKeepsTheSheetOpenToTryAgain() async {
        let channel = FakeChannel(failure: .failed("Your Mac is not reachable."))
        let sheet = model(request(name: "read_file"), channel: channel)
        await sheet.allowOnce()
        #expect(sheet.phase == .failed("Your Mac is not reachable."))
        #expect(!sheet.isBusy)
        #expect(!sheet.isClosing)
    }

    @Test func theSheetSendsNoDeviceItself() async {
        // `approval.respond` has no device field: the gateway stamps the device from the session.
        let params = ApprovalRespondParams(args: nil, callID: "c1", decision: .allowAlways, scope: nil, sessionID: "s1")
        let json = String(data: try! JSONEncoder().encode(params), encoding: .utf8)!
        #expect(!json.contains("device"))
    }
}

@MainActor
@Suite struct ReviewModelTests {
    private final class Responder: ReviewResponder, @unchecked Sendable {
        private let lock = NSLock()
        private var log: [ReviewAnswer] = []
        var answers: [ReviewAnswer] { lock.withLock { log } }
        func answer(_ answer: ReviewAnswer, for review: ReviewRequest) async throws {
            lock.withLock { log.append(answer) }
        }
    }

    @Test func approveSendsNoTextForAnUnchangedDraft() async {
        let responder = Responder()
        let review = ReviewModel(request: .fixture, responder: responder)
        await review.approve()
        #expect(responder.answers == [.approve])
        #expect(review.phase == .done(.approve))
    }

    @Test func editAndApproveSendsTheEditedDraft() async {
        let responder = Responder()
        let review = ReviewModel(request: .fixture, responder: responder)
        review.draft += "\n\u{2022} 1 more"
        #expect(review.isEdited)
        await review.approve()
        #expect(responder.answers == [.approveEdited(ReviewRequest.fixture.draft + "\n\u{2022} 1 more")])
    }

    @Test func rejectSendsTheReason() async {
        let responder = Responder()
        let review = ReviewModel(request: .fixture, responder: responder)
        await review.reject(reason: "  wrong channel \n")
        #expect(responder.answers == [.reject(reason: "wrong channel")])
    }

    @Test func theCardIsOffOutsideADebugFlag() {
        #expect(!ReviewFeature.isEnabled(arguments: []))
    }
}
