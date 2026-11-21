import GolemKit
import SwiftUI

/// A minimal list of the Mac's sessions, newest first, so the app shows that the pairing works.
/// The real tabs (Inbox, Sessions, …) come with the next tickets.
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
            .navigationTitle(model.macName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(model.macName).font(.headline)
                        Text(Self.describe(model.connection))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("sessions.state")
                    }
                }
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

    static func describe(_ state: ConnectionState) -> String {
        switch state {
        case .connecting: "Connecting"
        case .connected: "Connected"
        case .macUnreachable: "Your Mac is not reachable"
        case .relayUnreachable: "The relay is not reachable"
        case .stopped(let reason):
            switch reason {
            case .pairAgain: "Pair again"
            case .revoked: "Revoked on your Mac"
            case .replaced: "Open in another place"
            case .incompatible: "Update the app"
            case .stopped: "Stopped"
            }
        }
    }
}
