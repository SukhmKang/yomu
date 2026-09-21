@preconcurrency import AVFoundation
import UIKit

/// A capture session that stays alive for the whole app run, so returning from the
/// reader to shoot the next page costs nothing.
@MainActor
final class CameraController: NSObject, ObservableObject {
    enum Status: Equatable {
        case idle
        case denied
        case failed(String)
        case running
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var isCapturing = false

    /// The viewfinder's shape. The preview fills its bounds by cropping the sensor
    /// image, so the photo covers more than was framed; captures are cropped back to
    /// this so what you saw is what you get — and so the OCR is not handed the
    /// surroundings you deliberately kept out of shot.
    var previewAspectRatio: CGFloat?

    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "yomu.camera")
    private var configured = false
    private var pendingCapture: CheckedContinuation<UIImage, Error>?

    func start() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else { status = .denied; return }
        default:
            status = .denied
            return
        }
        if !configured {
            guard configure() else { return }
            configured = true
        }
        let session = self.session
        await withCheckedContinuation { continuation in
            queue.async {
                if !session.isRunning { session.startRunning() }
                continuation.resume()
            }
        }
        status = .running
    }

    func stop() {
        let session = self.session
        queue.async { if session.isRunning { session.stopRunning() } }
        if status == .running { status = .idle }
    }

    private func configure() -> Bool {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            status = .failed("No camera is available on this device.")
            return false
        }
        session.addInput(input)

        guard session.canAddOutput(output) else {
            status = .failed("The camera could not be prepared.")
            return false
        }
        session.addOutput(output)
        output.maxPhotoQualityPrioritization = .quality

        // When whatever the reader focused on leaves the frame, go back to
        // following the page rather than staying locked on a stale point.
        NotificationCenter.default.addObserver(
            forName: .AVCaptureDeviceSubjectAreaDidChange,
            object: device,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.resumeContinuousFocus() }
        }

        // Manga pages are flat and close; keep autofocus biased to near subjects.
        if let _ = try? device.lockForConfiguration() {
            if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
            if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
            if device.isSmoothAutoFocusSupported { device.isSmoothAutoFocusEnabled = true }
            device.unlockForConfiguration()
        }
        return true
    }

    /// Focus and meter on a point the reader tapped. `point` is in device space
    /// (0–1, from the preview layer's conversion), not view coordinates.
    func focus(at point: CGPoint) {
        guard let device = (session.inputs.compactMap { $0 as? AVCaptureDeviceInput }.first)?.device,
              (try? device.lockForConfiguration()) != nil else { return }
        defer { device.unlockForConfiguration() }

        if device.isFocusPointOfInterestSupported {
            device.focusPointOfInterest = point
            if device.isFocusModeSupported(.autoFocus) { device.focusMode = .autoFocus }
        }
        if device.isExposurePointOfInterestSupported {
            device.exposurePointOfInterest = point
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
        }
        // Go back to tracking the page once the tapped point is sharp.
        device.isSubjectAreaChangeMonitoringEnabled = true
    }

    /// After the tapped subject moves out of frame, resume following the page.
    func resumeContinuousFocus() {
        guard let device = (session.inputs.compactMap { $0 as? AVCaptureDeviceInput }.first)?.device,
              (try? device.lockForConfiguration()) != nil else { return }
        defer { device.unlockForConfiguration() }
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
        }
        device.isSubjectAreaChangeMonitoringEnabled = false
    }

    func capture() async throws -> UIImage {
        guard status == .running else { throw YomuError.message("The camera is not ready yet.") }
        isCapturing = true
        defer { isCapturing = false }

        let settings = AVCapturePhotoSettings()
        settings.photoQualityPrioritization = .balanced
        if let connection = output.connection(with: .video), connection.isVideoRotationAngleSupported(90) {
            connection.videoRotationAngle = 90  // portrait
        }
        let captured: UIImage = try await withCheckedThrowingContinuation { continuation in
            pendingCapture = continuation
            output.capturePhoto(with: settings, delegate: self)
        }
        guard let aspect = previewAspectRatio else { return captured }
        return captured.centreCropped(toAspectRatio: aspect)
    }
}

extension CameraController: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput,
                                 didFinishProcessingPhoto photo: AVCapturePhoto,
                                 error: Error?) {
        let result: Result<UIImage, Error>
        if let error {
            result = .failure(YomuError.message(error.localizedDescription))
        } else if let data = photo.fileDataRepresentation(), let image = UIImage(data: data) {
            result = .success(image)
        } else {
            result = .failure(YomuError.message("That photo could not be read. Try again."))
        }
        Task { @MainActor in
            let continuation = self.pendingCapture
            self.pendingCapture = nil
            continuation?.resume(with: result)
        }
    }
}
