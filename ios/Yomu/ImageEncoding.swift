import UIKit

/// A downscaled JPEG plus the size it was encoded at. Vision returns coordinates in
/// the space of the image it was given, so boxes must be normalised against this
/// size and not the original — otherwise every tap target lands in the wrong place.
struct EncodedImage {
    let base64: String
    let size: CGSize
}

extension UIImage {
    /// Vision does not need full sensor resolution, and the request body has to stay
    /// well under the serverless limit.
    func downscaledJPEG(maxDimension: CGFloat = 2048, quality: CGFloat = 0.85) -> EncodedImage? {
        let longest = max(size.width, size.height)
        let scale = longest > maxDimension ? maxDimension / longest : 1
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
        guard let data = rendered.jpegData(compressionQuality: quality) else { return nil }
        return EncodedImage(base64: data.base64EncodedString(), size: target)
    }
}

extension UIImage {
    /// Trim to the given width-to-height ratio about the centre, which is the part
    /// an aspect-fill preview was showing.
    func centreCropped(toAspectRatio aspect: CGFloat) -> UIImage {
        guard aspect > 0, size.width > 0, size.height > 0 else { return self }
        let current = size.width / size.height
        guard abs(current - aspect) > 0.001 else { return self }

        let target = current > aspect
            ? CGSize(width: size.height * aspect, height: size.height)   // trim sides
            : CGSize(width: size.width, height: size.width / aspect)     // trim top and bottom

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = scale
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(at: CGPoint(x: (target.width - size.width) / 2,
                             y: (target.height - size.height) / 2))
        }
    }
}
