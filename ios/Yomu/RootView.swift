import PhotosUI
import SwiftUI

/// The camera is the app. Launching lands on a live viewfinder; the reader is an
/// overlay above a session that never stops, so the next page is one tap away.
struct RootView: View {
    @EnvironmentObject private var backend: Backend
    @StateObject private var camera = CameraController()
    @State private var reader: ReaderModel?
    @State private var captureError: String?

    var body: some View {
        ZStack {
            CameraScreen(camera: camera, captureError: $captureError, onCapture: present)

            if let reader {
                ReaderView(model: reader) { dismissReader() }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(1)
            }

        }
        .animation(.snappy(duration: 0.3), value: reader == nil)
        .task { await camera.start() }
    }

    private func present(_ image: UIImage) {
        reader = ReaderModel(image: image, backend: backend)
    }

    private func dismissReader() {
        reader = nil
    }
}

private struct CameraScreen: View {
    @ObservedObject var camera: CameraController
    @Binding var captureError: String?
    let onCapture: (UIImage) -> Void
    @State private var pickedItem: PhotosPickerItem?
    @State private var showSettings = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch camera.status {
            case .running:
                CameraPreview(session: camera.session) { camera.focus(at: $0) }
                    .ignoresSafeArea()
            case .denied:
                message("Yomu needs camera access to read your page. Enable it in Settings → Yomu.")
            case .failed(let text):
                message(text)
            case .idle:
                ProgressView().tint(.white)
            }

            VStack {
                Spacer()
                if let captureError {
                    Text(captureError)
                        .font(.footnote)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.bottom, 16)
                }
                HStack {
                    libraryPicker
                    Spacer()
                    shutter
                    Spacer()
                    Button { showSettings = true } label: {
                        Image(systemName: "slider.horizontal.3")
                            .font(.title2)
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .accessibilityLabel("Preferences")
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 34)
            }
        }
        .onChange(of: pickedItem) { _, item in load(item) }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    /// Reading a screenshot or a digital page is the same job as reading a photo.
    private var libraryPicker: some View {
        PhotosPicker(selection: $pickedItem, matching: .images, photoLibrary: .shared()) {
            Image(systemName: "photo.on.rectangle")
                .font(.title2)
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
        }
        .accessibilityLabel("Choose a photo")
    }

    private func load(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            defer { pickedItem = nil }
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data) else {
                captureError = "That image could not be opened."
                return
            }
            onCapture(image)
        }
    }

    private var shutter: some View {
        Button(action: capture) {
            ZStack {
                Circle().stroke(.white.opacity(0.9), lineWidth: 4).frame(width: 78, height: 78)
                Circle().fill(.white).frame(width: 64, height: 64)
                    .scaleEffect(camera.isCapturing ? 0.86 : 1)
            }
        }
        .disabled(camera.status != .running || camera.isCapturing)
        .opacity(camera.status == .running ? 1 : 0.35)
        .animation(.snappy(duration: 0.15), value: camera.isCapturing)
        .accessibilityLabel("Capture page")
    }

    private func capture() {
        Task {
            do {
                captureError = nil
                onCapture(try await camera.capture())
            } catch {
                captureError = error.localizedDescription
            }
        }
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.callout)
            .multilineTextAlignment(.center)
            .foregroundStyle(.white.opacity(0.8))
            .padding(32)
    }
}
