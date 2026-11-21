import Foundation

/// `mcp__github__get_me` reads `github · get_me`; any other name is left as it is.
public func displayToolName(_ name: String) -> String {
    guard let (server, tool) = mcpParts(name) else { return name }
    return "\(server) \u{b7} \(tool)"
}

/// `mcp__<server>__<tool>` as the server and the tool: the server is the shortest part, as `(.+?)` reads.
private func mcpParts(_ name: String) -> (String, String)? {
    guard name.hasPrefix("mcp__") else { return nil }
    let rest = name.dropFirst(5)
    guard let split = rest.range(of: "__"), split.lowerBound != rest.startIndex, split.upperBound != rest.endIndex else {
        return nil
    }
    return (String(rest[..<split.lowerBound]), String(rest[split.upperBound...]))
}

/// The dot of one tool in the activity line.
public enum StepMark: String, Sendable, Equatable {
    case allow, deny, wait, run
}

/// A call that did not succeed: it failed, was denied, or ran and reported it did not work.
public func stepFailed(_ tool: ToolBlock) -> Bool {
    tool.status == .failed || (tool.status == .done && tool.unsuccessful == true)
}

public func stepMark(_ tool: ToolBlock) -> StepMark {
    if stepFailed(tool) { return .deny }
    if tool.status == .waiting { return .wait }
    return tool.status == .done ? .allow : .run
}

private func plural(_ count: Int, _ one: String, _ many: String) -> String {
    "\(count) \(count == 1 ? one : many)"
}

private func group(of name: String) -> (key: String, label: (Int) -> String) {
    if let (server, _) = mcpParts(name) {
        return ("mcp:\(server)", { plural($0, "\(server) call", "\(server) calls") })
    }
    switch name {
    case "web_search": return ("search", { _ in "searched the web" })
    case "web_fetch": return ("fetch", { "fetched \(plural($0, "page", "pages"))" })
    case "read_file": return ("read", { "read \(plural($0, "file", "files"))" })
    case "list_dir", "glob", "grep": return ("files", { _ in "searched files" })
    case "write_file", "edit_file": return ("edit", { "edited \(plural($0, "file", "files"))" })
    case "delegate": return ("delegate", { plural($0, "helper", "helpers") })
    case "shell": return ("shell", { "ran \(plural($0, "command", "commands"))" })
    default: return ("other", { plural($0, "tool", "tools") })
    }
}

/// The activity line of a turn: the tools grouped by kind, in the order each kind first appears,
/// with failures counted per group and the approvals at the end. Empty with no tools.
///
/// `searched the web · read 3 files · 3 github calls, 1 failed · ran 2 commands · 1 approval`
public func summarizeSteps(_ tools: [ToolBlock]) -> String {
    var order: [String] = []
    var groups: [String: (count: Int, failed: Int, label: (Int) -> String)] = [:]
    for tool in tools {
        let (key, label) = group(of: tool.name)
        var entry = groups[key] ?? (0, 0, label)
        if groups[key] == nil { order.append(key) }
        entry.count += 1
        if stepFailed(tool) { entry.failed += 1 }
        groups[key] = entry
    }
    var parts = order.compactMap { key -> String? in
        guard let entry = groups[key] else { return nil }
        return "\(entry.label(entry.count))\(entry.failed > 0 ? ", \(entry.failed) failed" : "")"
    }
    let approvals = tools.filter { $0.approval != nil }.count
    if approvals > 0 { parts.append(plural(approvals, "approval", "approvals")) }
    return parts.joined(separator: " \u{b7} ")
}

/// The quiet form of the line: `1 step`, `5 steps`.
public func stepCount(_ count: Int) -> String {
    plural(count, "step", "steps")
}

/// The choices of the detail switch.
public enum Detail: String, Sendable, CaseIterable {
    case quiet, normal, verbose
}

public func isDetail(_ value: String?) -> Bool {
    Detail(rawValue: value ?? "") != nil
}

/// The question for a call whose approval says more than "allow it": turning on an MCP server also lets
/// the model use that server's tools in this chat. Nil for any other call, which gets the usual question.
public func approvalQuestion(name: String, args: [String: JSONAny]) -> String? {
    guard name == "mcp_enable", let server = args["name"]?.value as? String, !server.isEmpty else { return nil }
    return "Turn on \(server) and let it use its tools in this chat?"
}
