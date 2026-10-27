import Foundation

public struct Connection: Codable, Equatable, Sendable {
  public let baseURL: URL
  public let token: String
  public init(baseURL: URL, token: String) throws {
    guard
      baseURL.scheme == "https"
        || (baseURL.scheme == "http"
          && ["localhost", "127.0.0.1", "::1"].contains(baseURL.host ?? "")),
      baseURL.host != nil, baseURL.user == nil, baseURL.password == nil,
      baseURL.query == nil, baseURL.fragment == nil,
      baseURL.path.isEmpty || baseURL.path == "/", token.count >= 32
    else {
      throw MuseError.message("Use an HTTPS backend address and a valid app access token.")
    }
    self.baseURL = baseURL
    self.token = token
  }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      baseURL: c.decode(URL.self, forKey: .baseURL), token: c.decode(String.self, forKey: .token))
  }
}
public enum MuseError: Error, LocalizedError, Sendable {
  case message(String)
  public var errorDescription: String? {
    if case .message(let text) = self { return text }
    return nil
  }
}
public struct ServerStatus: Decodable, Sendable {
  public let mode: String
  public let calendar: String
  public let calendarEnabled: Bool
  public let calendarConfigured: Bool
  public let speechOutput: String
}
public struct CalendarEvent: Codable, Sendable {
  public let title: String
  public let start: String
  public let end: String
  public let timeZone: String
}
public struct Action: Codable, Identifiable, Sendable {
  public let id: String
  public let sessionId: String
  public let event: CalendarEvent
  public let status: String
  public let expiresAt: Double
}
public struct TurnResult: Decodable, Sendable {
  public let sessionId: String
  public let state: String
  public let statusText: String
  public let speechText: String
  public let simulated: Bool
  public let action: Action?
}
public struct StreamEvent: Decodable, Sendable {
  public let type: String
  public let text: String?
  public let result: TurnResult?
  public let message: String?
}
public enum Mood: String, CaseIterable, Sendable {
  case sleep, idle, listen, think, speak, loved, delighted, curious, confused, surprised, happy,
    error, approval
}
