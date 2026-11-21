import Foundation

/// The agent's todo list. `TodoStatus` is the protocol's own (`pending`, `in_progress`, `done`).
public struct TodoItem: Identifiable, Equatable {
    public var id: String
    public var text: String
    public var status: TodoStatus
}

/// `todos 2/5 · <the current step>`, or `todos 5/5 done`. Empty for an empty list.
public func todoSummary(_ todos: [TodoItem]) -> String {
    if todos.isEmpty { return "" }
    let done = todos.filter { $0.status == .done }.count
    let current = todos.first { $0.status == .inProgress } ?? todos.first { $0.status != .done }
    guard let current else { return "todos \(done)/\(todos.count) done" }
    return "todos \(done)/\(todos.count) \u{b7} \(current.text)"
}
