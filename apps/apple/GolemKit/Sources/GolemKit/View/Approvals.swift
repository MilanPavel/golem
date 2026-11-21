import Foundation

// What the approval sheet needs: the question with the facts in front of the owner, which answers
// need proof that the owner is holding the phone (ADR-052), and the rule "Always allow" will write.

/// A tool call that waits for an answer, with where it runs and who asks. The words the sheet shows
/// are made here once, so a screen holds no logic of its own.
public struct ApprovalRequest: Equatable, Identifiable, Sendable {
    /// The session the answer goes to: a helper's own session for a helper's question.
    public var sessionId: String
    public var callId: String
    public var name: String
    /// The command of a shell call; nil for any other tool.
    public var command: String?
    /// What the call is about, as one line: the daemon's subject, else a command or a file path.
    public var subject: String?
    /// The change a file tool would make, as a unified diff.
    public var diff: String?
    /// The call's arguments as pretty JSON, for a tool that has no command and no diff.
    public var argsText: String
    /// The file a file tool names (its `path` argument).
    public var path: String?
    /// The session's folder; nil when the Mac does not say.
    public var folder: String?
    /// The session or routine that asks, as the Inbox names it.
    public var origin: String
    /// The helper that asks, for a helper's question.
    public var helper: String?
    /// The rule that asked, such as `built-in default`.
    public var source: String
    /// For an MCP tool: whether its server marks it read-only. Nil when the app does not know.
    public var mcpReadOnly: Bool?

    public var id: String { "\(sessionId)/\(callId)" }

    public init(
        sessionId: String, callId: String, name: String, command: String? = nil, subject: String? = nil,
        diff: String? = nil, argsText: String = "", path: String? = nil, folder: String? = nil, origin: String,
        helper: String? = nil, source: String = "", mcpReadOnly: Bool? = nil
    ) {
        self.sessionId = sessionId
        self.callId = callId
        self.name = name
        self.command = command
        self.subject = subject
        self.diff = diff
        self.argsText = argsText
        self.path = path
        self.folder = folder
        self.origin = origin
        self.helper = helper
        self.source = source
        self.mcpReadOnly = mcpReadOnly
    }

    /// From an `approval.needed` event as the transcript holds it.
    public init(
        pending: PendingApproval, sessionId: String, origin: String, folder: String?, helper: String? = nil,
        subject: String? = nil, mcpReadOnly: Bool? = nil
    ) {
        func text(_ key: String) -> String? {
            guard let value = pending.args[key]?.value as? String, !value.isEmpty else { return nil }
            return value
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let json = (try? encoder.encode(pending.args)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let isShell = pending.name == "shell" || pending.name == "shell_unsandboxed"
        self.init(
            sessionId: sessionId, callId: pending.callId, name: pending.name,
            command: isShell ? text("command") : nil,
            subject: subject ?? text("command") ?? text("path"),
            diff: pending.diff.flatMap { $0.isEmpty ? nil : $0 },
            argsText: pending.args.isEmpty ? "" : json, path: text("path"), folder: folder, origin: origin,
            helper: helper, source: pending.source, mcpReadOnly: mcpReadOnly
        )
    }

    /// What the monospace block shows: the command, else the diff, else the arguments.
    public var detail: String {
        if let command { return command }
        if let diff { return diff }
        return argsText
    }
}

// MARK: - The risky tools (ADR-052)

private let readTools: Set<String> = [
    "read_file", "list_dir", "glob", "grep", "git_status", "git_diff", "git_log", "web_fetch", "web_search",
    "read_artifact", "todo_write",
]

/// Whether `path` is inside `folder`, with `..` and `~` resolved. A relative path is read from the folder.
func isInside(path: String, folder: String) -> Bool {
    let root = URL(fileURLWithPath: (folder as NSString).expandingTildeInPath).standardizedFileURL.path
    let expanded = (path as NSString).expandingTildeInPath
    let full = expanded.hasPrefix("/") ? expanded : root + "/" + expanded
    let resolved = URL(fileURLWithPath: full).standardizedFileURL.path
    return resolved == root || resolved.hasPrefix(root.hasSuffix("/") ? root : root + "/")
}

/// Whether Allow once on this call needs proof that the owner holds the phone. It can run code or
/// change something beyond the session's folder: `shell` and `shell_unsandboxed`, a file write or edit
/// on a path outside the folder, an MCP tool its server does not mark read-only, and a tool the app
/// does not recognise. The lock-screen action (14.6.2) calls this too.
public func isRiskyApproval(_ request: ApprovalRequest) -> Bool {
    let name = request.name
    if readTools.contains(name) { return false }
    if name == "shell" || name == "shell_unsandboxed" { return true }
    if name == "write_file" || name == "edit_file" {
        guard let path = request.path, let folder = request.folder else { return true }
        return !isInside(path: path, folder: folder)
    }
    if name.hasPrefix("mcp__") { return request.mcpReadOnly != true }
    return true
}

// MARK: - The rule "Always allow" writes

/// The rule `allow_always` saves for this call, in the words the sheet shows. The daemon writes the rule
/// for exactly this call (`shell(git status)`, `mcp__linear__create_issue`). The device it notes is the
/// one the gateway knows from the connection, not a name the phone sends.
public func alwaysAllowRuleText(_ request: ApprovalRequest) -> String {
    guard !request.name.hasPrefix("mcp__"),
        let subject = request.subject.map({ $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }),
        !subject.isEmpty, subject != "{}", subject != "[]"
    else { return request.name }
    return "\(request.name)(\(subject.count > 80 ? "\(subject.prefix(80))\u{2026}" : subject))"
}

/// The sentence under "Always allow this tool", as the mock has it.
public func alwaysAllowNote(_ request: ApprovalRequest, deviceName: String) -> String {
    let place = request.folder.map { " in \($0)" } ?? ""
    return "\u{201c}Always allow\u{201d} saves a rule on your Mac for \(alwaysAllowRuleText(request))\(place), "
        + "marked from \(deviceName). Deny rules still win."
}
