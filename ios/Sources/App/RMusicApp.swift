import SwiftUI

@main
struct RMusicApp: App {
    @State private var model = RMusicAppModel()

    var body: some Scene {
        WindowGroup {
            RMusicRootView()
                .environment(model)
        }
    }
}
