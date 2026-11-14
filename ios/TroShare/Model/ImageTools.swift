import CoreImage
import SwiftUI
import UIKit
import Vision

extension UIImage {
    /// Redraws the image upright, no larger than `maxDimension` on its long edge.
    func downscaled(maxDimension: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        let factor = longest > maxDimension ? maxDimension / longest : 1
        let target = CGSize(width: (size.width * factor).rounded(), height: (size.height * factor).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}

enum Cutout {
    /// Lifts the product out of its background: Vision subject segmentation first, then (where Vision
    /// isn't available, e.g. the simulator) a flood fill that clears the white studio backdrop.
    static func foreground(of image: UIImage) async -> UIImage? {
        guard let cgImage = image.downscaled(maxDimension: 1024).cgImage else { return nil }
        return await Task.detached(priority: .userInitiated) { () -> UIImage? in
            if let lifted = visionCutout(cgImage) { return UIImage(cgImage: lifted) }
            return removeWhiteBackdrop(cgImage).map { UIImage(cgImage: $0) }
        }.value
    }

    private static func visionCutout(_ cgImage: CGImage) -> CGImage? {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
            guard let observation = request.results?.first else { return nil }
            let buffer = try observation.generateMaskedImage(
                ofInstances: observation.allInstances, from: handler, croppedToInstancesExtent: true)
            let ciImage = CIImage(cvPixelBuffer: buffer)
            return CIContext().createCGImage(ciImage, from: ciImage.extent)
        } catch {
            return nil
        }
    }

    /// Clears near-white pixels connected to the image edges (so white parts *inside* the product stay),
    /// feathers the edge, and crops to what's left.
    static func removeWhiteBackdrop(_ cgImage: CGImage) -> CGImage? {
        let w = cgImage.width, h = cgImage.height
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let raw = ctx.data else { return nil }
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))
        let px = raw.bindMemory(to: UInt8.self, capacity: w * h * 4)

        let solid = 226, clear = 246  // darkest channel: <= solid keeps, >= clear removes, between feathers
        func lightness(_ p: Int) -> Int { Int(min(px[p * 4], px[p * 4 + 1], px[p * 4 + 2])) }

        var visited = [Bool](repeating: false, count: w * h)
        var stack: [Int] = []
        func seed(_ p: Int) { if !visited[p] && lightness(p) > solid { visited[p] = true; stack.append(p) } }
        for x in 0..<w { seed(x); seed((h - 1) * w + x) }
        for y in 0..<h { seed(y * w); seed(y * w + w - 1) }

        while let p = stack.popLast() {
            let l = lightness(p)
            let alpha = l >= clear ? 0 : 255 * (clear - l) / (clear - solid)
            let i = p * 4
            for c in 0..<3 { px[i + c] = UInt8(Int(px[i + c]) * alpha / 255) }
            px[i + 3] = UInt8(alpha)
            let x = p % w, y = p / w
            if x > 0 { seed(p - 1) }
            if x < w - 1 { seed(p + 1) }
            if y > 0 { seed(p - w) }
            if y < h - 1 { seed(p + w) }
        }

        var minX = w, minY = h, maxX = -1, maxY = -1
        for y in 0..<h {
            for x in 0..<w where px[(y * w + x) * 4 + 3] > 24 {
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        guard maxX > minX, maxY > minY, let full = ctx.makeImage() else { return nil }
        return full.cropping(to: CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1))
    }
}

/// System camera, for taking room photos.
struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
