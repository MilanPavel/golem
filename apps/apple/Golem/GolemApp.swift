import SwiftUI

@main
struct GolemApp: App {
    @State private var model: AppModel

    init() {
        #if DEBUG
        let environment = DebugEnvironment.fromLaunchArguments() ?? .live()
        #else
        let environment = AppEnvironment.live()
        #endif
        _model = State(initialValue: AppModel(environment: environment))
    }

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                #if DEBUG
                // A tapped golem:// link pairs too. It is a debugging aid until the release decides.
                .onOpenURL { model.handle(linkText: $0.absoluteString) }
                #endif
        }
    }
}
