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
  public let gmailDraftsEnabled: Bool?
  public let notion: String?
  public let notionParent: NotionPage?
  public let instagram: String?
  public let facebook: String?
  public let socialAccounts: SocialAccounts?
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
  public let operation: String?
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
  public let gmailDraftAction: GmailDraftAction?
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
  public init(start: String, end: String) { self.start = start; self.end = end }
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
public struct CallProgress: Codable, Sendable {
  public let stage: String
  public let text: String
}
public struct CallAction: Codable, Identifiable, Sendable {
  public let id: String
  public let sessionId: String
  public let booking: CallBooking
  public let status: String
  public let expiresAt: Double
  public let finishedAt: Double?
  public let updatedAt: Double?
  public var needsAttention: Bool { status == "pending" || status == "uncertain" }
  public func recentlyCompleted(now: Date = Date()) -> Bool {
    guard !active, !needsAttention, let finishedAt else { return false }
    let age = now.timeIntervalSince1970 - finishedAt / 1000
    return age >= 0 && age <= 24 * 60 * 60
  }
  public func taskTimeText(timeZone: TimeZone = .autoupdatingCurrent) -> String? {
    guard let timestamp = finishedAt ?? updatedAt else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_GB")
    formatter.timeZone = timeZone
    formatter.dateFormat = "h:mm a"
    formatter.amSymbol = "am"
    formatter.pmSymbol = "pm"
    return formatter.string(from: Date(timeIntervalSince1970: timestamp / 1000))
  }
  public let calendarChecked: Bool
  public let outcome: String?
  public let progress: CallProgress?
  public let bookedSlot: BookingWindow?
  public let summary: String?
  public var active: Bool { ["starting", "queued", "in_progress"].contains(status) }
  public let operation: String?
  public let sourceCallId: String?
  public let supersededBy: String?
  public let calendarActionId: String?
  public let originalSlot: BookingWindow?
  public let retryOfCallId: String?
  public let retriedBy: String?
  public let followUp: BookingFollowUp?
  public var booked: Bool { status == "completed" && ["booked", "rescheduled"].contains(outcome ?? "") }
  public var bookingCancelled: Bool { status == "completed" && outcome == "booking_cancelled" }
  public var resultTitle: String {
    if bookingCancelled { return "booking cancelled" }
    if booked { return outcome == "rescheduled" ? "booking rescheduled" : "booking confirmed" }
    return "booking update"
  }
  /// Completion cards show the booked instant in the viewer's current device timezone.
  public func completionDateText(timeZone: TimeZone = .autoupdatingCurrent) -> String? {
    guard let slot = bookedSlot else { return nil }
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: slot.start) ?? ISO8601DateFormatter().date(from: slot.start) else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_GB")
    formatter.timeZone = timeZone
    formatter.dateFormat = "EEE, d MMM · h:mm a"
    formatter.amSymbol = "am"
    formatter.pmSymbol = "pm"
    return formatter.string(from: date)
  }
}

public struct SocialAccount: Codable, Identifiable, Sendable {
  public let id: String
  public let name: String
}
public struct SocialAccounts: Decodable, Sendable {
  public let instagram: SocialAccount?
  public let facebook: SocialAccount?
}
public struct AvailableSocialAccounts: Decodable, Sendable {
  public let accounts: [SocialAccount]
}
public enum IntegrationSignIn {
  public static func isAllowed(_ url: URL, provider: String) -> Bool {
    let hosts = ["google": "accounts.google.com", "gmail": "accounts.google.com",
                 "notion": "api.notion.com", "instagram": "www.facebook.com", "facebook": "www.facebook.com"]
    guard let host = hosts[provider] else { return false }
    return url.scheme == "https" && url.host == host && url.user == nil && url.password == nil
      && (url.port == nil || url.port == 443)
  }
}

public struct GmailDraftAction: Decodable, Identifiable, Sendable {
  public let id: String
  public let sessionId: String
  public let to: String
  public let subject: String
  public let body: String
  public let status: String
  public let expiresAt: Double
  public var needsReview: Bool { ["pending", "executing", "uncertain"].contains(status) }
}
public struct JollyReminder: Decodable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let dueAt: String
  public let timeZone: String
  public let status: String
  public let recurrence: String
  public var formattedDueAt: String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var date = parser.date(from: dueAt)
    if date == nil { parser.formatOptions = [.withInternetDateTime]; date = parser.date(from: dueAt) }
    guard let date else { return dueAt }
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    formatter.timeZone = TimeZone(identifier: timeZone) ?? .current
    return formatter.string(from: date)
  }
}
public struct DailyBriefing: Decodable, Sendable {
  public let summary: String
  public let date: String
  public let timeZone: String
  public let simulated: Bool
  public let sources: [String: String]
}

public struct BookingFollowUp: Codable, Sendable {
  public let canRetry: Bool
  public let canChange: Bool
  public let canAddReminder: Bool
  public let needsVerification: Bool
  public let message: String
}
public struct BookingProfile: Codable, Sendable {
  public var destinationName: String = ""
  public var phoneNumber: String = ""
  public var purpose: String = "haircut"
  public var customerName: String = ""
  public var durationMinutes: Int = 30
  public var timeZone: String = TimeZone.current.identifier
  public var preferredDays: [Int] = [1, 2, 3, 4, 5]
  public var preferredStart: String = "14:00"
  public var preferredEnd: String = "18:00"
  public init() {}
}

public struct DemoReadiness: Decodable, Sendable {
  public let revision: String
  public let mode: String
  public let checkedAt: Double
  public let configurationReady: Bool
  public let readyForDemo: Bool
  public let checks: [Check]
  public let usage: Usage
  public struct Check: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let status: String
    public let detail: String
  }
  public struct Usage: Decodable, Sendable {
    public let periodStart: String
    public let callAttempts: Int
    public let callLimit: Int
    public let remainingCalls: Int
    public let activeCalls: Int
    public let unverifiedCalls: Int
    public let notes: String
  }
}
