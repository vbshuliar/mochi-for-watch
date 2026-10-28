import MuseCore
import SwiftUI

struct ActionReview: View {
  let action: Action
  let busy: Bool
  let decide: (Bool) -> Void
  private func date(_ raw: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let value = parser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    guard let value else { return raw }
    let formatter = DateFormatter()
    formatter.timeZone = TimeZone(identifier: action.event.timeZone)
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: value)
  }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        Text("Review event").font(.headline)
        Text(action.event.title).font(.title3.bold())
        Text(date(action.event.start))
        Text("until \(date(action.event.end))")
        Text(action.event.timeZone).font(.caption).foregroundStyle(.secondary)
        Text(
          action.status == "uncertain"
            ? "The last save wasn’t verified. Check it before trying again."
            : "Nothing is saved until you confirm."
        ).font(.caption)
        Button(action.status == "uncertain" ? "Verify save" : "Add to Calendar") { decide(true) }
          .buttonStyle(.borderedProminent).disabled(busy)
        Button("Cancel", role: .cancel) { decide(false) }.disabled(
          busy || action.status == "uncertain")
        if busy { ProgressView("saving…") }
      }.padding()
    }
  }
}

struct DocumentReview: View {
  let dismiss: () -> Void
  let action: DocumentAction
  let busy: Bool
  let decide: (Bool) -> Void
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        Text("Review Notion page").font(.headline)
        Text(action.title).font(.title3.bold())
        Text("Save under: \(action.parentTitle)").font(.caption).foregroundStyle(.secondary)
        Text(action.body).font(.body)
        if action.status == "uncertain" || action.status == "executing" {
          Text("The save wasn’t verified. Check Notion before creating another page. Automatic retries are disabled to avoid duplicates.").font(.caption)
          Button("Back to Jolly") { dismiss() }.disabled(busy)
        } else {
          Text("Nothing is saved until you confirm.").font(.caption)
          Button("Save to Notion") { decide(true) }.buttonStyle(.borderedProminent).disabled(busy)
          Button("Cancel", role: .cancel) { decide(false) }.disabled(busy)
        }
        if busy { ProgressView("saving…") }
      }.padding()
    }
  }
}

struct CallReview: View {
  let model: ConversationModel
  let call: CallAction
  private func date(_ raw: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let value = parser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return raw }
    let formatter = DateFormatter()
    formatter.timeZone = TimeZone(identifier: call.booking.timeZone)
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: value)
  }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        Text(call.status == "pending" ? "Review phone call" : "Phone call update").font(.headline)
        Text(call.booking.destinationName).font(.title3.bold())
        Text(call.booking.phoneNumber)
        Text(call.booking.purpose)
        Text("Booking for: \(call.booking.customerName)")
        ForEach(Array(call.booking.allowedWindows.enumerated()), id: \.offset) { _, window in
          Text("Between \(date(window.start)) and \(date(window.end))")
        }
        Text("\(call.booking.durationMinutes) minutes · \(call.booking.timeZone)").font(.caption)
        Text(call.calendarChecked ? "Calendar checked for availability." : "Calendar has not been checked. Availability is unverified.").font(.caption)
        if let summary = call.summary { Text(summary) }
        if let slot = call.bookedSlot { Text("Booked: \(date(slot.start)) until \(date(slot.end))") }
        if let failure = model.failure { Text(failure).font(.caption) }
        if call.status == "pending", !model.callConfirmationUnknown {
          Text("Jolly will call this number as your AI assistant and share these booking details only after you approve.").font(.caption)
          Button("Approve and call") { model.callCommand("confirm") }.buttonStyle(.borderedProminent)
          Button("Cancel", role: .cancel) { model.callCommand("cancel") }
        } else {
          Text(call.status.replacingOccurrences(of: "_", with: " ")).font(.headline)
          if call.status == "uncertain" || model.callConfirmationUnknown && call.status == "pending" {
            Text("The result could not be verified. Check with the business before making another booking. Jolly will not redial automatically.").font(.caption)
          }
          if call.active || call.status == "uncertain" { Button(call.status == "uncertain" ? "Try stopping call" : "Stop call", role: .destructive) { model.callCommand("stop") } }
          if call.booked { Button("Review Calendar event") { model.callCommand("calendar") }.buttonStyle(.borderedProminent) }
          Button("Refresh status") { model.callCommand("refresh") }
          if !call.active { Button("Back to Jolly") { model.dismissCall() } }
        }
        if model.deciding { ProgressView("Updating…") }
      }.padding().disabled(model.deciding)
    }.onAppear { model.resumeCalls() }
  }
}
