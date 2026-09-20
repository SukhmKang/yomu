import SwiftUI

/// The page, with everything the reader needs arriving underneath it automatically.
struct ReaderView: View {
    @ObservedObject var model: ReaderModel
    let onNextPage: () -> Void

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()

            PageView(image: model.image,
                     regions: model.regions,
                     selected: model.selected,
                     bottomInset: model.selection.isEmpty ? 0 : UnderstandPanel.openHeight,
                     onSelect: model.select)
                .ignoresSafeArea(edges: .horizontal)

            topBar
        }
        // Overlaid rather than inset: insetting shrank the page when the panel
        // opened, which re-fitted the image and slid every tap target out from
        // under the finger, so the next tap landed on the wrong bubble.
        .overlay(alignment: .bottom) {
            UnderstandPanel(model: model)
        }
        .task { await model.scan() }
    }

    private var topBar: some View {
        HStack {
            status
            Spacer()
            Button(action: onNextPage) {
                Label("Next page", systemImage: "camera.fill")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(.ultraThinMaterial, in: Capsule())
            }
        }
        .padding(.horizontal, 16)
        .tint(.white)
    }

    @ViewBuilder private var status: some View {
        if model.isScanning {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini).tint(.white)
                Text("Reading page…")
            }
            .font(.caption)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
        } else if let error = model.scanError {
            Text(error)
                .font(.caption)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.ultraThinMaterial, in: Capsule())
        }
    }
}

/// Bottom panel: the selection, its vocabulary, and its explanation. No buttons to
/// press — selecting text on the page fills all three.
private struct UnderstandPanel: View {
    static let openHeight: CGFloat = 320

    @ObservedObject var model: ReaderModel

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(.white.opacity(0.25))
                .frame(width: 36, height: 4)
                .padding(.vertical, 8)

            if model.selection.isEmpty {
                hint
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        selectedText
                        if !model.vocabulary.isEmpty { vocabulary }
                        explanation
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: model.selection.isEmpty ? 64 : Self.openHeight)
        .background(.regularMaterial)
        .animation(.snappy(duration: 0.28), value: model.selection.isEmpty)
    }

    private var hint: some View {
        Text(model.isScanning ? "Reading the page…" : "Drag across the page to select text")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxHeight: .infinity)
    }

    private var selectedText: some View {
        Text(model.selection)
            .font(.system(size: 19, weight: .medium))
            .lineSpacing(4)
            .textSelection(.enabled)
    }

    private var vocabulary: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(model.vocabulary) { entry in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(entry.word)
                        .font(.system(size: 16, weight: .semibold))
                    if !entry.reading.isEmpty, entry.reading != entry.word {
                        Text(entry.reading)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text(entry.meaning)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
    }

    @ViewBuilder private var explanation: some View {
        switch model.explanation {
        case .none:
            EmptyView()
        case .loading:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("やさしく説明を作っています…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case .streaming(let text), .ready(let text):
            VStack(alignment: .leading, spacing: 6) {
                Text("やさしく説明")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(text)
                    .font(.system(size: 16))
                    .lineSpacing(5)
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 8) {
                Text(message).font(.footnote).foregroundStyle(.secondary)
                Button("Try again") { model.retryExplanation() }
                    .font(.footnote.weight(.semibold))
            }
        }
    }
}
