// Deterministic artwork exports from the exact renderer used by the native app.
// Run native/scripts/render-artwork.sh from any directory.
import AppKit
import SwiftUI
import MochiCore

@main struct RenderArtwork {
  @MainActor static func main() throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    func render(face: Bool, opaque: Bool) throws -> Data {
      let content = Canvas { context, size in
        if opaque { context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.black)) }
        MochiView.drawHead(context: context, size: size, pose: FacePose(), includeFace: face)
      }.frame(width: 1024, height: 1024)
      let renderer = ImageRenderer(content: content)
      renderer.scale = 1
      renderer.isOpaque = opaque
      guard let image = renderer.cgImage,
        let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
      else { fatalError("Could not render Mochi artwork") }
      return png
    }
    let portrait = try render(face: true, opaque: false)
    let plate = try render(face: false, opaque: false)
    let icon = try render(face: true, opaque: true)
    for (data, paths) in [
      (portrait, ["docs/design/mochi-portrait.png", "website/dist/assets/mochi.png"]),
      (plate, ["docs/design/mochi-face-plate.png", "website/dist/assets/mochi-face.png", "native/Resources/Assets.xcassets/Mochi.imageset/mochi.png"]),
      (icon, ["native/Resources/Assets.xcassets/AppIcon.appiconset/icon.png"]),
    ] {
      for path in paths { try data.write(to: root.appendingPathComponent(path)) }
    }
  }
}
