// Render a static version of the native Jolly component for the app launcher.
import AppKit
import SwiftUI

@MainActor func renderIcon() throws {
  let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
  guard
    let plate = NSImage(
      contentsOf: root.appendingPathComponent("Resources/Assets.xcassets/Jolly.imageset/jolly.png"))
  else { fatalError("Missing Jolly resource") }
  let content = ZStack {
    Color.black
    Image(nsImage: plate).resizable().frame(width: 920, height: 920)
      .overlay {
        Canvas { c, size in
          var c = c
          c.scaleBy(x: size.width / 1000, y: size.height / 1000)
          for x in [335.0, 665.0] {
            c.fill(
              Path(ellipseIn: CGRect(x: x - 33, y: 484, width: 66, height: 72)),
              with: .radialGradient(
                Gradient(colors: [Color(white: 0.17), Color(white: 0.02)]),
                center: CGPoint(x: x + 10, y: 503), startRadius: 1, endRadius: 38))
            c.fill(
              Path(ellipseIn: CGRect(x: x + 7, y: 493, width: 10, height: 18)),
              with: .color(.white.opacity(0.85)))
          }
          var smile = Path()
          smile.move(to: CGPoint(x: 451, y: 592))
          smile.addCurve(
            to: CGPoint(x: 549, y: 592), control1: CGPoint(x: 470, y: 624),
            control2: CGPoint(x: 530, y: 624))
          c.stroke(
            smile, with: .color(Color(red: 0.16, green: 0.1, blue: 0.08)),
            style: StrokeStyle(lineWidth: 7, lineCap: .round))
        }
      }
  }.frame(width: 1024, height: 1024)
  let renderer = ImageRenderer(content: content)
  renderer.scale = 1
  renderer.isOpaque = true
  guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
  else { fatalError("Couldn’t render icon") }
  try png.write(
    to: root.appendingPathComponent("Resources/Assets.xcassets/AppIcon.appiconset/icon.png"))
}
try MainActor.assumeIsolated { try renderIcon() }
