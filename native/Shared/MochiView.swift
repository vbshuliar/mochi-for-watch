import MochiCore
import SwiftUI

struct MochiView: View {
  let mood: Mood
  var level: Double = 0
  var heartStart: Date?
  var calling = false
  @Environment(\.accessibilityReduceMotion) private var reduced
  @Environment(\.scenePhase) private var scenePhase
  @State private var started = Date()
  @State private var previous = FacePose()
  @State private var transition = 0.65
  @State private var mouthTransition = 0.4
  private func pose(at date: Date) -> FacePose {
    let elapsed = max(0, date.timeIntervalSince(started))
    let target = MochiMotion.pose(
      mood, time: max(0, elapsed - (mood == .idle ? transition : 0)), level: level, reduced: reduced
    )
    return previous.blended(
      to: target, progress: MochiMotion.ease(elapsed / (reduced ? 0.15 : transition)),
      mouthProgress: MochiMotion.ease(elapsed / mouthTransition))
  }
  var body: some View {
    TimelineView(
      .animation(minimumInterval: reduced ? 0.2 : 1.0 / 30, paused: scenePhase != .active)
    ) { timeline in
      Canvas { context, size in
        let p = pose(at: timeline.date)
        let edge = min(size.width, size.height)
        Self.drawHead(context: context, size: size, pose: p)
        if let heartStart {
          let elapsed = timeline.date.timeIntervalSince(heartStart)
          for (i, point) in [
            CGPoint(x: 0.12, y: 0.5), CGPoint(x: 0.87, y: 0.28), CGPoint(x: 0.23, y: 0.2),
          ].enumerated() {
            let age = elapsed - Double(i) * 0.22
            guard age >= 0, elapsed < 3.6 else { continue }
            var hearts = context
            hearts.opacity = max(0, min(1, age / 0.35, (3.6 - elapsed) / 0.7))
            hearts.draw(
              Text("❤️").font(.system(size: edge * (i == 1 ? 0.1 : 0.08))),
              at: CGPoint(
                x: point.x * size.width,
                y: point.y * size.height - (reduced ? 0 : min(1, age / 3.6) * edge * 0.08)))
          }
        }
      }
    }
    .overlay(alignment: .topTrailing) {
      if calling {
        Text("📞").font(.system(size: 28))
          .padding(.top, 16).padding(.trailing, 10)
          .transition(.scale.combined(with: .opacity))
      }
    }
    .animation(reduced ? nil : .spring(response: 0.35, dampingFraction: 0.65), value: calling)
    .accessibilityHidden(true)
    .onChange(of: mood) { old, _ in
      let now = Date()
      let elapsed = max(0, now.timeIntervalSince(started))
      let oldTarget = MochiMotion.pose(
        old, time: max(0, elapsed - (old == .idle ? transition : 0)), level: level, reduced: reduced
      )
      previous = previous.blended(
        to: oldTarget, progress: MochiMotion.ease(elapsed / transition),
        mouthProgress: MochiMotion.ease(elapsed / mouthTransition))
      transition = old == .speak && mood == .idle ? 1.4 : 0.65
      mouthTransition = mood == .speak || old == .speak ? 0.08 : 0.4
      started = now
    }
  }
  // Shared by the live character and deterministic app/web artwork exports.
  static func drawHead(context: GraphicsContext, size: CGSize, pose p: FacePose, includeFace: Bool = true) {
    let edge = min(size.width, size.height)
    var c = context
    c.translateBy(x: size.width / 2, y: size.height / 2 + edge * 0.15 + p.y * edge / 368)
    c.rotate(by: .degrees(p.angle))
    c.scaleBy(x: p.scale, y: p.scale)
    c.translateBy(x: -edge / 2, y: -edge * 0.65)
    c.scaleBy(x: edge / 1000, y: edge / 1000)
    let yaw = p.yaw * .pi / 180
    let pitch = p.pitch * .pi / 180
    // A rounded volume barely changes silhouette as it turns; its face
    // travels across the surface and foreshortens much more noticeably.
    c.translateBy(x: 500, y: 500)
    c.scaleBy(x: 0.94 + 0.06 * cos(yaw), y: 0.95 + 0.05 * cos(pitch))
    c.translateBy(x: -500, y: -500)
    let body = bodyPath()
    // Broad upper-left lighting keeps the face bright while the sides roll
    // into shadow. Vector gradients stay smooth at Watch resolution.
    c.fill(body, with: .radialGradient(
      Gradient(stops: [
        .init(color: Color(red: 235 / 255, green: 255 / 255, blue: 148 / 255), location: 0),
        .init(color: Color(red: 212 / 255, green: 244 / 255, blue: 92 / 255), location: 0.44),
        .init(color: Color(red: 184 / 255, green: 216 / 255, blue: 64 / 255), location: 0.76),
        .init(color: Color(red: 133 / 255, green: 166 / 255, blue: 43 / 255), location: 1),
      ]), center: CGPoint(x: 370 - sin(yaw) * 100, y: 325 + sin(pitch) * 80), startRadius: 0, endRadius: 650))
    var rim = c
    rim.clip(to: body)
    rim.stroke(body, with: .linearGradient(
      Gradient(stops: [
        .init(color: Color(red: 249 / 255, green: 255 / 255, blue: 195 / 255).opacity(0.7), location: 0),
        .init(color: .clear, location: 0.46),
        .init(color: .clear, location: 1),
      ]), startPoint: CGPoint(x: 220, y: 180), endPoint: CGPoint(x: 800, y: 830)),
      lineWidth: 22)
    guard includeFace else { return }
    // Project the face on the front of the rounded head. Roll uses the
    // outer context; yaw and pitch move the features along the other axes.
    var face = c
    face.translateBy(x: 500 + sin(yaw) * 235, y: 500 - sin(pitch) * 215)
    face.scaleBy(x: cos(yaw), y: cos(pitch))
    face.translateBy(x: -500, y: -500)
    for x in [335.0, 665.0] {
      var eyeContext = face
      eyeContext.translateBy(x: x + p.gazeX, y: 487 + p.gazeY)
      let perspective = 1800 / (1800 + (x - 500) * sin(yaw))
      eyeContext.scaleBy(x: perspective, y: perspective)
      let eye = eyePath(openness: p.eye, joy: p.joy)
      eyeContext.fill(
        eye,
        with: .radialGradient(
          Gradient(colors: [Color(white: 0.17), Color(white: 0.02)]),
          center: CGPoint(x: 10, y: -17), startRadius: 1, endRadius: 38))
      eyeContext.clip(to: eye)
      if p.eye > 0.3 {
        eyeContext.opacity = min(0.9, p.eye)
        eyeContext.fill(
          Path(ellipseIn: CGRect(x: 7, y: -27, width: 10, height: 18)), with: .color(.white))
      }
    }
    let width = p.width * 1.25
    let x = 500 + p.gazeX * 0.25
    let y = 548 + p.gazeY * 0.18
    var mouth = Path()
    mouth.move(to: CGPoint(x: x - width, y: y))
    mouth.addCurve(
      to: CGPoint(x: x + width, y: y),
      control1: CGPoint(x: x - width * 0.6, y: y + p.smile),
      control2: CGPoint(x: x + width * 0.6, y: y + p.smile))
    mouth.addCurve(
      to: CGPoint(x: x - width, y: y),
      control1: CGPoint(x: x + width * 0.9, y: y + p.smile + p.mouth),
      control2: CGPoint(x: x - width * 0.9, y: y + p.smile + p.mouth))
    mouth.closeSubpath()
    face.fill(
      mouth,
      with: .linearGradient(
        Gradient(colors: [
          Color(red: 0.16, green: 0.07, blue: 0.06), Color(red: 0.44, green: 0.2, blue: 0.18),
        ]), startPoint: CGPoint(x: x, y: y), endPoint: CGPoint(x: x, y: y + 65)))
    face.stroke(
      mouth, with: .color(Color(red: 0.16, green: 0.1, blue: 0.08)),
      style: StrokeStyle(lineWidth: 10, lineCap: .round, lineJoin: .round))
    if p.mouth > 8 {
      var tongue = face
      tongue.clip(to: mouth)
      tongue.fill(
        Path(
          ellipseIn: CGRect(x: x - 32, y: y + p.smile + p.mouth * 0.6, width: 64, height: 28)),
        with: .color(Color(red: 0.74, green: 0.47, blue: 0.45)))
    }
  }
  // Original native geometry follows the project's Mochi silhouette. Smooth vector shading
  // avoids bitmap texture and resampling noise on the small Watch display.
  private static func bodyPath() -> Path {
    var body = Path()
    body.move(to: CGPoint(x: 500, y: 145))
    body.addCurve(to: CGPoint(x: 887, y: 355),
      control1: CGPoint(x: 705, y: 145), control2: CGPoint(x: 843, y: 200))
    body.addCurve(to: CGPoint(x: 920, y: 560),
      control1: CGPoint(x: 909, y: 432.5), control2: CGPoint(x: 920, y: 485))
    // Each lower quarter is one uninterrupted convex arc. Vertical side
    // tangents meet a shared horizontal bottom tangent without cheek seams.
    body.addCurve(to: CGPoint(x: 500, y: 840),
      control1: CGPoint(x: 920, y: 735), control2: CGPoint(x: 740, y: 840))
    body.addCurve(to: CGPoint(x: 80, y: 560),
      control1: CGPoint(x: 260, y: 840), control2: CGPoint(x: 80, y: 735))
    body.addCurve(to: CGPoint(x: 113, y: 355),
      control1: CGPoint(x: 80, y: 485), control2: CGPoint(x: 91, y: 432.5))
    body.addCurve(to: CGPoint(x: 500, y: 145),
      control1: CGPoint(x: 157, y: 200), control2: CGPoint(x: 295, y: 145))
    body.closeSubpath()
    return body
  }
  private static func eyePath(openness: Double, joy: Double) -> Path {
    let o = max(0, min(1.45, openness))
    let close = 1 - min(1, o / 0.7)
    let curve = (12 - joy * 34) * close
    let rx = 39 - close
    let ry = 3 + o * 36
    let k = 0.5522848
    var p = Path()
    p.move(to: CGPoint(x: -rx, y: 0))
    p.addCurve(
      to: CGPoint(x: 0, y: curve - ry), control1: CGPoint(x: -rx, y: -ry * k),
      control2: CGPoint(x: -rx * k, y: curve - ry))
    p.addCurve(
      to: CGPoint(x: rx, y: 0), control1: CGPoint(x: rx * k, y: curve - ry),
      control2: CGPoint(x: rx, y: -ry * k))
    p.addCurve(
      to: CGPoint(x: 0, y: curve + ry), control1: CGPoint(x: rx, y: ry * k),
      control2: CGPoint(x: rx * k, y: curve + ry))
    p.addCurve(
      to: CGPoint(x: -rx, y: 0), control1: CGPoint(x: -rx * k, y: curve + ry),
      control2: CGPoint(x: -rx, y: ry * k))
    p.closeSubpath()
    return p
  }
}
