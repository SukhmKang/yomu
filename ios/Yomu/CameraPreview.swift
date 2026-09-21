import AVFoundation
import SwiftUI

/// Full-bleed live preview. This is the app's home screen — no button to reach it.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    /// Receives a point in device space (0–1) for focus and metering.
    let onFocus: (CGPoint) -> Void
    /// Reports the viewfinder's shape so captures can be cropped to match it.
    let onResize: (CGFloat) -> Void

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.layer.session = session
        view.layer.videoGravity = .resizeAspectFill
        view.onFocus = onFocus
        view.onResize = onResize
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        view.onFocus = onFocus
        view.onResize = onResize
        if view.layer.session !== session { view.layer.session = session }
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        override var layer: AVCaptureVideoPreviewLayer { super.layer as! AVCaptureVideoPreviewLayer }

        var onFocus: ((CGPoint) -> Void)?
        var onResize: ((CGFloat) -> Void)?
        private let reticle = UIView()

        override init(frame: CGRect) {
            super.init(frame: frame)
            addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap)))

            reticle.frame = CGRect(x: 0, y: 0, width: 72, height: 72)
            reticle.layer.borderColor = UIColor.systemYellow.cgColor
            reticle.layer.borderWidth = 1.5
            reticle.layer.cornerRadius = 6
            reticle.isUserInteractionEnabled = false
            reticle.alpha = 0
            addSubview(reticle)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func layoutSubviews() {
            super.layoutSubviews()
            guard bounds.height > 0 else { return }
            onResize?(bounds.width / bounds.height)
        }

        @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
            let point = gesture.location(in: self)
            onFocus?(layer.captureDevicePointConverted(fromLayerPoint: point))
            show(at: point)
        }

        /// Brief confirmation that the tap registered somewhere specific.
        private func show(at point: CGPoint) {
            reticle.center = point
            reticle.transform = CGAffineTransform(scaleX: 1.35, y: 1.35)
            reticle.alpha = 1
            UIView.animate(withDuration: 0.25) {
                self.reticle.transform = .identity
            } completion: { _ in
                UIView.animate(withDuration: 0.3, delay: 0.55) { self.reticle.alpha = 0 }
            }
        }
    }
}
