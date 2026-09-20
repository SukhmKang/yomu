import UIKit
import VisionKit

/// On-device OCR. VisionKit's ImageAnalyzer (the Live Text engine) is the only Apple
/// API that reads vertical Japanese — VNRecognizeTextRequest returns nothing for it.
/// It also strips furigana and joins columns in correct reading order.
@MainActor
final class PageAnalyzer {
    private let analyzer = ImageAnalyzer()

    func analyze(_ image: UIImage) async throws -> ImageAnalysis {
        guard ImageAnalyzer.isSupported else {
            throw YomuError.message("This device cannot read text from images.")
        }
        do {
            return try await analyzer.analyze(image, configuration: .init([.text]))
        } catch {
            throw YomuError.message("The page could not be read. Try another photo.")
        }
    }
}
