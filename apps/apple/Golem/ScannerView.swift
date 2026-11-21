import AVFoundation
import SwiftUI
import VisionKit

/// The camera scanner for the pairing QR code: VisionKit's `DataScannerViewController`, which
/// SwiftUI cannot make by itself. It calls `onLink` once for a `golem://` code.
struct ScannerView: View {
    let onLink: (String) -> Void

    var body: some View {
        if DataScannerViewController.isSupported {
            ScannerRepresentable(onLink: onLink)
        } else {
            Placeholder(text: "This device has no camera to scan with.")
        }
    }
}

private struct Placeholder: View {
    let text: String

    var body: some View {
        ZStack {
            Color.black
            Text(text)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding()
        }
    }
}

private struct ScannerRepresentable: UIViewControllerRepresentable {
    let onLink: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: false,
            isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.onLink = onLink
        guard !scanner.isScanning else { return }
        Task { @MainActor in
            if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
                _ = await AVCaptureDevice.requestAccess(for: .video)
            }
            if DataScannerViewController.isAvailable {
                try? scanner.startScanning()
            }
        }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onLink: onLink) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onLink: (String) -> Void

        init(onLink: @escaping (String) -> Void) { self.onLink = onLink }

        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let barcode) in addedItems {
                if let text = barcode.payloadStringValue, text.lowercased().hasPrefix("golem://") {
                    onLink(text)
                    return
                }
            }
        }
    }
}
