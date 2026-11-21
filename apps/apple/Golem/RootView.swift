import SwiftUI

struct RootView: View {
    let model: AppModel

    var body: some View {
        switch model.screen {
        case .scan(let message):
            PairingView(model: model, message: message)
        case .connecting:
            WaitingView(title: "Reaching your Mac", detail: "Through the relay. This takes a moment.", model: model)
        case .confirm(let words):
            ConfirmView(words: words, model: model)
        case .paired(let name):
            PairedView(macName: name, model: model)
        case .tabs:
            MainTabs(model: model)
        }
    }
}

/// Inbox, Automations and Chats. The Inbox is first.
struct MainTabs: View {
    let model: AppModel

    var body: some View {
        TabView {
            InboxView(model: model)
                .tabItem { Label("Inbox", systemImage: "tray") }
            AutomationsView(model: model)
                .tabItem { Label("Automations", systemImage: "clock") }
            SessionListView(model: model)
                .tabItem { Label("Chats", systemImage: "bubble.left") }
        }
        // The banner shows on every tab when the Mac cannot be reached.
        .safeAreaInset(edge: .top, spacing: 0) { ConnectionBanner(model: model) }
        // One sheet for every tab, so an approval opens from the Inbox and from Chats alike.
        .approvalSheet(model)
        .reviewSheet(model)
    }
}

/// An empty place for the routines. They come with a later ticket.
struct AutomationsView: View {
    let model: AppModel

    var body: some View {
        NavigationStack {
            ContentUnavailableView("No automations yet", systemImage: "clock")
                .accessibilityIdentifier("automations.empty")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .principal) { ConnectionHeader(model: model) } }
        }
    }
}
