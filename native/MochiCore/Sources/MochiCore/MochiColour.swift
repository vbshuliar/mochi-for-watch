import Foundation

public enum MochiColour: String, CaseIterable, Sendable, Identifiable {
  case lime, mint, sky, lilac, peach, rose
  public var id: String { rawValue }
  public var title: String { rawValue.capitalized }
  // Highlight, body, lower side, shadow, rim. Lime preserves the original artwork.
  public var shades: [UInt32] {
    switch self {
    case .lime: return [0xEBFF94, 0xD4F45C, 0xB8D840, 0x85A62B, 0xF9FFC3]
    case .mint: return [0xB6FFE0, 0x6CEBB6, 0x43C896, 0x238A6C, 0xDEFFF0]
    case .sky: return [0xBDEEFF, 0x79D4FA, 0x4EAFDF, 0x307DA9, 0xE2F7FF]
    case .lilac: return [0xE9D5FF, 0xC6A0F6, 0xA27DD5, 0x7653A7, 0xF6ECFF]
    case .peach: return [0xFFE0AF, 0xFFBB7C, 0xDE9657, 0xA66B3A, 0xFFF0D6]
    case .rose: return [0xFFD2E1, 0xF99DBE, 0xD5769E, 0xA24D76, 0xFFEBF2]
    }
  }
}
