import SwiftUI

@main
struct YomuApp: App {
    @StateObject private var backend = Backend()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(backend)
                .preferredColorScheme(.dark)
                .statusBarHidden()
        }
    }
}
