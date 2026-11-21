import GolemKit
import SwiftUI

/// The Mac's name and how the phone is connected to it, at the top of every tab.
struct ConnectionHeader: View {
    let model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Text(model.macName).font(.headline)
            Text(model.banner?.cause == .noNetwork ? "No network" : Self.describe(model.connection, mac: model.macName))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("connection.state")
        }
    }

    static func describe(_ state: ConnectionState, mac: String) -> String {
        switch state {
        case .connecting: "Connecting"
        case .connected: "Connected to \(mac)"
        case .macUnreachable: "Can't reach your Mac"
        case .relayUnreachable: "Can't reach the relay"
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
