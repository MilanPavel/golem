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
                // A golem://pair link from the Camera app or a tap opens pairing with the code filled in, in
                // every build. The three words and the confirmation on the Mac still guard it. Other URLs are ignored.
                .onOpenURL { url in
                    guard url.scheme == "golem", url.host == "pair" else { return }
                    model.handle(linkText: url.absoluteString)
                }
                #if DEBUG
                // `-pairLink <golem://pair link>` starts pairing at launch, for an end-to-end run from the shell.
                .task {
                    let arguments = ProcessInfo.processInfo.arguments
                    if let at = arguments.firstIndex(of: "-pairLink"), at + 1 < arguments.count {
                        model.handle(linkText: arguments[at + 1])
                    }
                }
                #endif
        }
    }
}
