import GolemKit
import SwiftUI

/// The Chats tab: the Mac's sessions, newest first.
struct SessionListView: View {
    let model: AppModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.sessions.sessions) { session in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.title ?? "Untitled session")
                            Text(session.status)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
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
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { ConnectionHeader(model: model) }
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
        }
    }
}
