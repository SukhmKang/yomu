import SwiftUI

/// The captured page with a tap target over each text region.
///
/// A tap picks a region, a drag sweeps across several, and tapping empty space
/// clears — the model the web version used. Apple's Live Text selection is not used:
/// it needs a long press before it engages and then hands over the system's
/// selection handles, which is unwieldy when selecting a bubble is the one thing you
/// do on every page.
struct PageView: UIViewRepresentable {
    let image: UIImage
    let regions: [TextRegion]
    let selected: Set<Int>
    /// How much of the bottom is covered by the panel. Added as scroll inset rather
    /// than taken out of the layout, so the image keeps its size and position.
    let bottomInset: CGFloat
    let onSelect: (Set<Int>) -> Void

    func makeUIView(context: Context) -> ZoomablePageView {
        let view = ZoomablePageView()
        view.setImage(image)
        view.onSelect = onSelect
        view.setRegions(regions, selected: selected)
        view.bottomInset = bottomInset
        return view
    }

    func updateUIView(_ view: ZoomablePageView, context: Context) {
        view.onSelect = onSelect
        if view.imageView.image !== image { view.setImage(image) }
        view.setRegions(regions, selected: selected)
        view.bottomInset = bottomInset
    }
}

final class ZoomablePageView: UIView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    let scrollView = UIScrollView()
    let imageView = UIImageView()
    var onSelect: ((Set<Int>) -> Void)?

    /// Extra room to scroll so bubbles behind the panel stay reachable. It never
    /// changes the image's size or centring, so tap targets do not move.
    var bottomInset: CGFloat = 0 {
        didSet { guard bottomInset != oldValue else { return }; centerImage() }
    }

    private let overlay = UIView()
    private var regions: [TextRegion] = []
    private var selected: Set<Int> = []
    private var targets: [UIView] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black

        scrollView.delegate = self
        scrollView.maximumZoomScale = 6
        scrollView.minimumZoomScale = 1
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        addSubview(scrollView)

        imageView.contentMode = .scaleAspectFit
        imageView.isUserInteractionEnabled = true
        scrollView.addSubview(imageView)

        overlay.backgroundColor = .clear
        imageView.addSubview(overlay)

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap))
        overlay.addGestureRecognizer(tap)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan))
        pan.delegate = self
        // A sweep that starts on a bubble selects; anywhere else the page pans.
        scrollView.panGestureRecognizer.require(toFail: pan)
        overlay.addGestureRecognizer(pan)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func setImage(_ image: UIImage) {
        imageView.image = image
        scrollView.zoomScale = 1
        setNeedsLayout()
    }

    func setRegions(_ regions: [TextRegion], selected: Set<Int>) {
        let changed = regions != self.regions
        self.regions = regions
        self.selected = selected
        if changed { rebuildTargets() } else { restyle() }
    }

    // MARK: - Layout

    override func layoutSubviews() {
        super.layoutSubviews()
        scrollView.frame = bounds
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
            overlay.frame = imageView.bounds
            layoutTargets()
        }
        centerImage()
    }

    private func centerImage() {
        let x = max(0, (scrollView.bounds.width - scrollView.contentSize.width) / 2)
        let y = max(0, (scrollView.bounds.height - scrollView.contentSize.height) / 2)
        scrollView.contentInset = UIEdgeInsets(top: y, left: x, bottom: y + bottomInset, right: x)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { centerImage() }

    // MARK: - Targets

    private func rebuildTargets() {
        targets.forEach { $0.removeFromSuperview() }
        targets = regions.map { _ in
            let view = UIView()
            view.layer.cornerRadius = 4
            view.layer.borderWidth = 1
            view.isUserInteractionEnabled = false
            overlay.addSubview(view)
            return view
        }
        layoutTargets()
        restyle()
    }

    private func layoutTargets() {
        let size = overlay.bounds.size
        guard size.width > 0, size.height > 0 else { return }
        for (index, region) in regions.enumerated() where index < targets.count {
            targets[index].frame = CGRect(x: region.rect.minX * size.width,
                                          y: region.rect.minY * size.height,
                                          width: region.rect.width * size.width,
                                          height: region.rect.height * size.height)
        }
    }

    private func restyle() {
        for (index, target) in targets.enumerated() {
            let on = selected.contains(index)
            target.backgroundColor = UIColor.systemTeal.withAlphaComponent(on ? 0.35 : 0.10)
            target.layer.borderColor = UIColor.white.withAlphaComponent(on ? 0.9 : 0.25).cgColor
        }
    }

    private func frame(for index: Int) -> CGRect {
        index < targets.count ? targets[index].frame : .zero
    }

    private func publish() {
        restyle()
        onSelect?(selected)
    }

    // MARK: - Gestures

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: overlay)
        guard let index = regions.indices.first(where: { frame(for: $0).contains(point) }) else {
            guard !selected.isEmpty else { return }
            selected.removeAll()
            publish()
            return
        }
        if selected.contains(index) { selected.remove(index) } else { selected.insert(index) }
        publish()
    }

    private var dragStart: CGPoint?
    private var dragBase: Set<Int> = []

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        let point = gesture.location(in: overlay)
        switch gesture.state {
        case .began:
            dragStart = point
            dragBase = selected
        case .changed, .ended:
            guard let start = dragStart else { return }
            let sweep = CGRect(x: min(start.x, point.x), y: min(start.y, point.y),
                               width: abs(point.x - start.x), height: abs(point.y - start.y))
            selected = dragBase
            for index in regions.indices where frame(for: index).intersects(sweep) {
                selected.insert(index)
            }
            publish()
            if gesture.state == .ended { dragStart = nil }
        case .cancelled, .failed:
            selected = dragBase
            dragStart = nil
            publish()
        default:
            break
        }
    }

    /// A sweep should be able to start on empty page and cross into the bubbles, so
    /// at rest the whole surface selects — the page already fits, so there is
    /// nothing to scroll. Once zoomed in the page does need to pan, and there a
    /// drag has to start on a bubble to mean selection.
    override func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
        guard gesture is UIPanGestureRecognizer else { return true }
        guard scrollView.zoomScale > scrollView.minimumZoomScale else { return true }
        let point = gesture.location(in: overlay)
        return regions.indices.contains { frame(for: $0).contains(point) }
    }
}
