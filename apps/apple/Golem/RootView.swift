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
        case .sessions:
            SessionListView(model: model)
        }
    }
}
