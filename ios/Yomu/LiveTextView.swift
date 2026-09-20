import SwiftUI
import VisionKit

/// The captured page, zoomable, with Apple's own Live Text selection layered on top.
/// Selection granularity is whatever the reader drags — a word, a bubble, or several —
/// so there is no word/passage mode to switch between.
struct LiveTextView: UIViewRepresentable {
    let image: UIImage
    let analysis: ImageAnalysis?
    let onSelectionChange: (String) -> Void

    func makeUIView(context: Context) -> ZoomablePageView {
        let view = ZoomablePageView()
        view.interaction.delegate = context.coordinator
        view.setImage(image)
        return view
    }

    func updateUIView(_ view: ZoomablePageView, context: Context) {
        context.coordinator.onSelectionChange = onSelectionChange
        if view.imageView.image !== image { view.setImage(image) }
        if view.interaction.analysis !== analysis {
            view.interaction.analysis = analysis
            // Only enable selection once there is an analysis, so the reader never
            // drags at text the app cannot yet read.
            view.interaction.preferredInteractionTypes = analysis == nil ? [] : .textSelection
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(onSelectionChange: onSelectionChange) }

    final class Coordinator: NSObject, ImageAnalysisInteractionDelegate {
        var onSelectionChange: (String) -> Void

        init(onSelectionChange: @escaping (String) -> Void) {
            self.onSelectionChange = onSelectionChange
        }

        func textSelectionDidChange(_ interaction: ImageAnalysisInteraction) {
            onSelectionChange(interaction.selectedText)
        }
    }
}

/// UIScrollView-based pinch/zoom around a single image view.
final class ZoomablePageView: UIView, UIScrollViewDelegate {
    let scrollView = UIScrollView()
    let imageView = UIImageView()
    let interaction = ImageAnalysisInteraction()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black

        scrollView.delegate = self
        scrollView.maximumZoomScale = 6
        scrollView.minimumZoomScale = 1
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.bouncesZoom = true
        addSubview(scrollView)

        imageView.contentMode = .scaleAspectFit
        imageView.isUserInteractionEnabled = true
        imageView.addInteraction(interaction)
        scrollView.addSubview(imageView)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func setImage(_ image: UIImage) {
        imageView.image = image
        scrollView.zoomScale = 1
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        scrollView.frame = bounds
        // Size the image view to the aspect-fit rect so Live Text's coordinate space
        // matches the pixels the reader actually sees.
        guard let image = imageView.image, image.size.width > 0, image.size.height > 0 else {
            imageView.frame = bounds
            scrollView.contentSize = bounds.size
            return
        }
        let scale = min(bounds.width / image.size.width, bounds.height / image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        if imageView.bounds.size != size {
            imageView.frame = CGRect(origin: .zero, size: size)
            scrollView.contentSize = size
        }
        centerImage()
    }

    private func centerImage() {
        let x = max(0, (scrollView.bounds.width - scrollView.contentSize.width) / 2)
        let y = max(0, (scrollView.bounds.height - scrollView.contentSize.height) / 2)
        scrollView.contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { centerImage() }
}
