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
  public let webSearch: Bool?
  public let gmail: String?
  public let notion: String?
  public let notionParent: NotionPage?
  public let callsConfigured: Bool?
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
public struct SearchSource: Decodable, Identifiable, Sendable {
  public let title: String
  public let url: URL
  public var id: String { url.absoluteString }
  public var safeURL: URL? {
    ["https", "http"].contains(url.scheme ?? "") && url.host != nil && url.user == nil && url.password == nil ? url : nil
  }
}
public struct TurnResult: Decodable, Sendable {
  public let sessionId: String
  public let state: String
  public let statusText: String
  public let speechText: String
  public let simulated: Bool
  public let action: Action?
  public let documentAction: DocumentAction?
  public let callAction: CallAction?
  public let sources: [SearchSource]?
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

public struct SavedMemory: Codable, Identifiable, Sendable {
  public let id: String
  public var title: String
  public var text: String
  public let updatedAt: Double
}
public struct MemoryList: Decodable, Sendable {
  public let memories: [SavedMemory]
}

public struct NotionPage: Codable, Identifiable, Sendable {
  public let id: String
  public let title: String
}
public struct NotionPages: Decodable, Sendable {
  public let pages: [NotionPage]
  public let hasMore: Bool
}
public struct DocumentAction: Codable, Identifiable, Sendable {
  public let id: String
  public let sessionId: String
  public let title: String
  public let body: String
  public let parentTitle: String
  public let status: String
  public let expiresAt: Double
}

public struct BookingWindow: Codable, Sendable {
  public let start: String
  public let end: String
}
public struct CallBooking: Codable, Sendable {
  public let destinationName: String
  public let phoneNumber: String
  public let purpose: String
  public let customerName: String
  public let timeZone: String
  public let window: BookingWindow
  public let windows: [BookingWindow]?
  public var allowedWindows: [BookingWindow] { windows ?? [window] }
  public let durationMinutes: Int
}
public struct CallAction: Codable, Identifiable, Sendable {
  public let id: String
  public let sessionId: String
  public let booking: CallBooking
  public let status: String
  public let expiresAt: Double
  public let calendarChecked: Bool
  public let slots: [BookingWindow]
  public let outcome: String?
  public let bookedSlot: BookingWindow?
  public let summary: String?
  public var active: Bool { ["starting", "queued", "in_progress"].contains(status) }
  public var booked: Bool { status == "completed" && outcome == "booked" }
}
