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
