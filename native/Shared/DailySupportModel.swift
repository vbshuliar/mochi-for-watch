import Foundation
import MuseCore
import Observation

@MainActor @Observable final class DailySupportModel {
  var readiness: DemoReadiness?
  var profile: BookingProfile?
  var briefing: DailyBriefing?
  var reminders: [JollyReminder] = []
  var drafts: [GmailDraftAction] = []
  var error: String?
  var busy = false
  private var generation = UUID()
  private var reminderRequest: (key: String, id: String)?
  private let store: ConnectionStore
  private let makeClient: (Connection) -> APIClient
  init(store: ConnectionStore, makeClient: @escaping (Connection) -> APIClient = { APIClient(connection: $0) }) {
    self.store = store
    self.makeClient = makeClient
  }
  func reset() {
    generation = UUID(); readiness = nil; profile = nil; reminderRequest = nil; briefing = nil; reminders = []; drafts = []; error = nil; busy = false
  }
  func refresh() async {
    guard !busy else { return }
    guard let connection = store.connection else { error = "Connect to Mochi to load your day."; return }
    busy = true
    let ticket = generation
    defer { if generation == ticket { busy = false } }
    do {
      struct Reminders: Decodable, Sendable { let reminders: [JollyReminder] }
      struct Drafts: Decodable, Sendable { let drafts: [GmailDraftAction] }
      let client = makeClient(connection)
      async let report = client.get("v1/briefing", as: DailyBriefing.self, query: [URLQueryItem(name: "timeZone", value: TimeZone.current.identifier)])
      async let reminderList = client.get("v1/reminders", as: Reminders.self)
      async let draftList = client.get("v1/drafts", as: Drafts.self)
      let values = try await (report, reminderList, draftList)
      guard generation == ticket, store.connection == connection else { return }
      briefing = values.0; reminders = values.1.reminders; drafts = values.2.drafts; error = nil
    } catch {
      guard generation == ticket, store.connection == connection else { return }
      self.error = error.localizedDescription
    }
  }
  func loadReadiness() async {
    guard !busy else { return }
    guard let connection = store.connection else { error = "Connect to Mochi to check readiness."; return }
    let ticket = generation; busy = true
    defer { if generation == ticket { busy = false } }
    do {
      let result = try await makeClient(connection).get("v1/readiness", as: DemoReadiness.self)
      guard generation == ticket, store.connection == connection else { return }
      readiness = result; error = nil
    } catch {
      guard generation == ticket, store.connection == connection else { return }
      self.error = error.localizedDescription
    }
  }
  func loadProfile() async -> Bool {
    guard !busy else { return false }
    guard let connection = store.connection else { error = "Connect to Mochi to load your booking preferences."; return false }
    let ticket = generation; busy = true
    defer { if generation == ticket { busy = false } }
    do {
      struct Envelope: Decodable, Sendable { let profile: BookingProfile? }
      let result = try await makeClient(connection).get("v1/booking-profile", as: Envelope.self)
      guard generation == ticket, store.connection == connection else { return false }
      profile = result.profile; error = nil; return true
    } catch {
      guard generation == ticket, store.connection == connection else { return false }
      self.error = error.localizedDescription; return false
    }
  }
  func saveProfile(_ value: BookingProfile?) async -> Bool {
    guard !busy else { return false }
    guard let connection = store.connection else { error = "Connect to Mochi before saving preferences."; return false }
    let ticket = generation; busy = true
    defer { if generation == ticket { busy = false } }
    do {
      let data = try value.map { try JSONEncoder().encode($0) }
      _ = try await makeClient(connection).data("v1/booking-profile", method: value == nil ? "DELETE" : "PUT", body: data)
      guard generation == ticket, store.connection == connection else { return false }
      profile = value; error = nil; return true
    } catch {
      guard generation == ticket, store.connection == connection else { return false }
      self.error = error.localizedDescription; return false
    }
  }
  func remindForBooking(_ call: CallAction, id: String, due: Date) async -> Bool {
    guard !busy else { return false }
    guard let connection = store.connection else { error = "Connect to Mochi before saving a reminder."; return false }
    let ticket = generation; busy = true
    defer { if generation == ticket { busy = false } }
    do {
      _ = try await makeClient(connection).json("v1/sessions/\(call.sessionId)/calls/\(call.id)/reminder", values: ["id": id, "dueAt": ISO8601DateFormatter().string(from: due), "timeZone": call.booking.timeZone])
      guard generation == ticket, store.connection == connection else { return false }
      error = nil; return true
    } catch {
      guard generation == ticket, store.connection == connection else { return false }
      self.error = error.localizedDescription; return false
    }
  }
  func updateReminder(_ reminder: JollyReminder, values: [String: String]) async {
    await mutate("v1/reminders/\(reminder.id)", method: "PATCH", values: values)
  }
  func deleteReminder(_ reminder: JollyReminder) async {
    await mutate("v1/reminders/\(reminder.id)", method: "DELETE", values: [:])
  }
  func beginReminder() {
    guard !busy else { return }
    reminderRequest = nil
    error = nil
  }
  func createReminder(title: String, due: Date, recurrence: String) async {
    guard !busy else { return }
    let key = "\(title)|\(due.timeIntervalSince1970)|\(recurrence)"
    if reminderRequest?.key != key { reminderRequest = (key, UUID().uuidString) }
    // Keep the key through follow-up refresh failures; only a new form or changed input starts a new request.
    await mutate("v1/reminders", method: "POST", values: ["id": reminderRequest!.id, "title": title, "dueAt": ISO8601DateFormatter().string(from: due), "timeZone": TimeZone.current.identifier, "recurrence": recurrence])
  }
  func decideDraft(_ draft: GmailDraftAction, confirm: Bool) async {
    await mutate("v1/sessions/\(draft.sessionId)/drafts/\(draft.id)/decision", method: "POST", values: ["decision": confirm ? "confirm" : "cancel"])
  }
  private func mutate(_ path: String, method: String, values: [String: String]) async {
    guard !busy else { return }
    guard let connection = store.connection else { error = "Connect to Mochi before saving changes."; return }
    let ticket = generation
    busy = true
    do {
      _ = try await makeClient(connection).json(path, method: method, values: values)
      guard generation == ticket, store.connection == connection else { return }
      busy = false
      await refresh()
    } catch {
      guard generation == ticket, store.connection == connection else { return }
      busy = false
      let failure = error.localizedDescription
      await refresh()
      guard generation == ticket, store.connection == connection else { return }
      self.error = failure
    }
  }
}
