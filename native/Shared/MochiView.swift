import MochiCore
import SwiftUI

struct MochiView: View {
  let mood: Mood
  var level: Double = 0
  var heartStart: Date?
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
        var c = context
        c.translateBy(x: size.width / 2, y: size.height / 2 + edge * 0.15 + p.y * edge / 368)
        c.rotate(by: .degrees(p.angle))
        c.scaleBy(x: p.scale, y: p.scale)
        c.translateBy(x: -edge / 2, y: -edge * 0.65)
        c.draw(Image("Mochi"), in: CGRect(x: 0, y: 0, width: edge, height: edge))
        c.scaleBy(x: edge / 1000, y: edge / 1000)
        for x in [335.0, 665.0] {
          var eyeContext = c
          eyeContext.translateBy(x: x + p.gazeX, y: 487 + p.gazeY)
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
        c.fill(
          mouth,
          with: .linearGradient(
            Gradient(colors: [
              Color(red: 0.16, green: 0.07, blue: 0.06), Color(red: 0.44, green: 0.2, blue: 0.18),
            ]), startPoint: CGPoint(x: x, y: y), endPoint: CGPoint(x: x, y: y + 65)))
        c.stroke(
          mouth, with: .color(Color(red: 0.16, green: 0.1, blue: 0.08)),
          style: StrokeStyle(lineWidth: 10, lineCap: .round, lineJoin: .round))
        if p.mouth > 8 {
          var tongue = c
          tongue.clip(to: mouth)
          tongue.fill(
            Path(
              ellipseIn: CGRect(x: x - 32, y: y + p.smile + p.mouth * 0.6, width: 64, height: 28)),
            with: .color(Color(red: 0.74, green: 0.47, blue: 0.45)))
        }
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
      mouthTransition = mood == .speak ? 0.18 : 0.4
      started = now
    }
  }
  private func eyePath(openness: Double, joy: Double) -> Path {
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
