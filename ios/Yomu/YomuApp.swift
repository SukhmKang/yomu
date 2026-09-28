import SwiftUI

@main
struct YomuApp: App {
    @StateObject private var backend = Backend()

    init() {
        // Start watching the network now, so the first scan knows Wi-Fi from cellular.
        _ = NetworkStatus.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(backend)
                .preferredColorScheme(.dark)
                .statusBarHidden()
        }
    }
}
