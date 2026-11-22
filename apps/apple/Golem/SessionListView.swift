import GolemKit
import SwiftUI

/// The Chats tab: the Mac's sessions, newest first.
struct SessionListView: View {
    let model: AppModel
    @State private var path: [SessionRoute] = []
    @State private var newTask: NewTaskModel?

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    ForEach(model.sessions.sessions) { session in
                        let title = session.title ?? "Untitled session"
                        NavigationLink(value: SessionRoute(sessionID: session.sessionId, title: title)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(title)
                                Text(session.status)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("chats.row.\(session.sessionId)")
                    }
                } footer: {
                    if let error = model.listError {
                        Text(error)
                    } else if model.sessions.sessions.isEmpty, model.connection == .connected {
                        Text("The Mac has no sessions yet.")
                    }
                }
            }
            .accessibilityIdentifier("sessions.list")
            .sessionDestination(model)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { ConnectionHeader(model: model) }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New task", systemImage: "square.and.pencil") { newTask = model.newTask() }
                        .accessibilityIdentifier("chats.new")
                }
                #if DEBUG
                ToolbarItem(placement: .topBarLeading) {
                    // Opens the approval sheet and the review card on fixtures, until the Inbox does it.
                    Menu("Debug") {
                        ForEach(DebugApprovals.all, id: \.id) { entry in
                            Button(entry.label) { model.present(approval: entry.request) }
                                .accessibilityIdentifier("debug.approval.\(entry.id)")
                        }
                        if ReviewFeature.isEnabled() {
                            Button("Review") {
                                model.present(review: .fixture, responder: FakeReviewResponder())
                            }
                            .accessibilityIdentifier("debug.review")
                        }
                    }
                    .accessibilityIdentifier("debug.menu")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Forget") { model.forgetMac() }
                        .accessibilityIdentifier("sessions.forget")
                }
                #endif
            }
            .refreshable { await model.refresh() }
            .sheet(item: $newTask) { task in
                NewTaskView(task: task, onStart: { id in
                    newTask = nil
                    path.append(SessionRoute(sessionID: id, title: "New task"))
                }, onCancel: { newTask = nil })
            }
        }
    }
}
