import Foundation

public struct FacePose: Sendable {
  public var angle = 0.0, y = 0.0, scale = 1.0, eye = 1.0, gazeX = 0.0, gazeY = 0.0
  public var smile = 24.0, mouth = 0.0, width = 49.0, joy = 0.0
  public init() {}
  public func blended(to target: FacePose, progress: Double, mouthProgress: Double? = nil)
    -> FacePose
  {
    func mix(_ a: Double, _ b: Double, _ p: Double) -> Double { a + (b - a) * min(1, max(0, p)) }
    var p = self
    p.angle = mix(angle, target.angle, progress)
    p.y = mix(y, target.y, progress)
    p.scale = mix(scale, target.scale, progress)
    p.eye = mix(eye, target.eye, progress)
    p.gazeX = mix(gazeX, target.gazeX, progress)
    p.gazeY = mix(gazeY, target.gazeY, progress)
    p.smile = mix(smile, target.smile, progress)
    p.joy = mix(joy, target.joy, progress)
    p.mouth = mix(mouth, target.mouth, mouthProgress ?? progress)
    p.width = mix(width, target.width, mouthProgress ?? progress)
    return p
  }
}
public enum MochiMotion {
  public static func ease(_ value: Double) -> Double {
    let u = min(1, max(0, value))
    return u * u * u * (u * (u * 6 - 15) + 10)
  }
  public static func pose(_ mood: Mood, time t: Double, level: Double = 0, reduced: Bool = false)
    -> FacePose
  {
    var p = FacePose()
    if !reduced {
      p.y = sin(t / 1.1) * 1.3
      p.scale += sin(t / 1.1) * 0.012
    }
    switch mood {
    case .sleep:
      p.eye = 0
      p.angle = reduced ? 0 : 9
      p.y = 8
      p.smile = 8
    case .idle:
      if !reduced {
        let glance = sin(t * 0.57) * pow(max(0, sin(t * 0.21)), 4)
        p.gazeX = glance * 20
        p.angle = glance * 3
      }
    case .listen:
      p.angle = reduced ? 0 : -5
      p.eye = 1.1
      p.gazeY = -4
      p.scale = 1 + min(1, max(0, level)) * 0.12
    case .think:
      p.gazeX = reduced ? 8 : sin(t * 0.73) * 23
      p.gazeY = -10
      p.angle = reduced ? 0 : sin(max(0, t - 0.18) * 0.73) * 5
      p.smile = 14
    case .speak:
      let phase = t.truncatingRemainder(dividingBy: 5.6)
      let speaking = phase < 1.65 || (phase > 2.15 && phase < 4.65)
      p.mouth = !reduced && speaking ? pow(max(0, sin(t * 13) + 0.3 * sin(t * 23)), 0.7) * 36 : 0
      p.width = 44 + (reduced ? 0 : sin(t * 4.4) * 7)
      p.angle = reduced ? 0 : sin(t * 2.1) * 2.5
      p.eye = 1.03
      p.y = reduced ? 0 : sin(t * 2.8) * 1.5
    case .loved:
      p.eye = 0.1
      p.joy = 1
      p.smile = 34
      p.width = 57
      p.angle = reduced ? 0 : -6
      p.scale = 1.025
    case .happy:
      p.eye = 0.1
      p.joy = 1
      p.smile = 36
      p.width = 60
    case .delighted:
      p.eye = 1.05
      p.mouth = 27
      p.width = 54
      p.smile = 14
    case .curious:
      p.angle = reduced ? 0 : -9
      p.gazeX = 12
      p.gazeY = -9
      p.eye = 1.07
    case .confused:
      p.angle = reduced ? 0 : 8
      p.gazeX = -16
      p.smile = 5
      p.width = 32
    case .surprised:
      p.eye = 1.3
      p.mouth = 30
      p.width = 24
      p.smile = 3
    case .error:
      p.angle = reduced ? 0 : 4
      p.smile = 4
      p.eye = 0.8
    case .approval:
      p.angle = reduced ? 0 : -4
      p.eye = 1.08
      p.smile = 16
    }
    if !reduced && ![Mood.sleep, .loved, .happy].contains(mood) {
      let blink = t.truncatingRemainder(dividingBy: 4.9)
      if blink > 4.65 { p.eye *= 1 - sin((blink - 4.65) / 0.25 * .pi) }
    }
    return p
  }
}
