import MuseCore
import SwiftUI

struct ActionReview: View {
  let action: Action
  let busy: Bool
  let decide: (Bool) -> Void
  private var approvalTitle: String { action.operation == "delete" ? "Remove from Calendar" : action.operation == "update" ? "Update Calendar event" : "Add to Calendar" }
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
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 5) {
          Text(action.operation == "delete" ? "Review event removal" : action.operation == "update" ? "Review event update" : "Review event").font(.caption).foregroundStyle(.secondary)
          Text(action.event.title).font(.headline)
        }
        VStack(alignment: .leading, spacing: 12) {
          ReviewDetail("Starts", value: date(action.event.start))
          ReviewDetail("Ends", value: date(action.event.end))
          ReviewDetail("Time zone", value: action.event.timeZone)
        }
        Divider()
        Text(
          action.status == "uncertain"
            ? "The last Calendar change wasn’t verified. Check it before trying again."
            : "Nothing changes in Calendar until you confirm."
        ).font(.footnote).foregroundStyle(.secondary)
        VStack(spacing: 8) {
          ReviewButton(action.status == "uncertain" ? "Verify Calendar change" : approvalTitle, prominent: true) { decide(true) }
            .disabled(busy)
          ReviewButton("Cancel", role: .cancel) { decide(false) }
            .disabled(busy || action.status == "uncertain")
        }
        if busy { ProgressView("saving…").frame(maxWidth: .infinity) }
      }.padding().frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
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
  @Environment(\.dismiss) private var close
  let model: ConversationModel
  let call: CallAction
  @State private var changingTime = false
  @State private var cancellingBooking = false
  @State private var windowStart = Date().addingTimeInterval(86400)
  @State private var windowEnd = Date().addingTimeInterval(90000)
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
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 5) {
          Text(call.status == "pending" ? "Review phone call" : "Phone call update")
            .font(.caption).foregroundStyle(.secondary)
          Text(call.booking.purpose).font(.headline)
          Text(call.booking.destinationName).font(.subheadline).foregroundStyle(.secondary)
        }
        VStack(alignment: .leading, spacing: 12) {
          ReviewDetail("Phone", value: call.booking.phoneNumber)
          ReviewDetail("Booking for", value: call.booking.customerName)
          if let original = call.originalSlot {
            ReviewDetail("Original appointment", value: "\(date(original.start)) until \(date(original.end))")
            Text(call.operation == "cancel_booking" ? "Ask the business to cancel this appointment." : "Ask the business to move this appointment to an allowed time below.").font(.footnote)
          }
          ForEach(Array(call.booking.allowedWindows.enumerated()), id: \.offset) { _, window in
            ReviewDetail("Allowed time", value: "Between \(date(window.start)) and \(date(window.end))")
          }
          ReviewDetail("Duration", value: "\(call.booking.durationMinutes) minutes")
          ReviewDetail("Time zone", value: call.booking.timeZone)
        }
        Divider()
        Text(call.calendarChecked ? "Calendar checked for availability." : "Calendar has not been checked. Availability is unverified.")
          .font(.footnote).foregroundStyle(.secondary)
        if let summary = call.summary { Text(summary).font(.body) }
        if call.supersededBy != nil { Text("This booking was changed. Open the newer task for the current appointment.").font(.footnote) }
        if let slot = call.bookedSlot {
          ReviewDetail("Booked", value: "\(date(slot.start)) until \(date(slot.end))")
        }
        if let failure = model.failure { Text(failure).font(.footnote) }
        if call.status == "pending", !model.confirmationUnknown(for: call) {
          Text("Jolly will call this number as your AI assistant and share these booking details only after you approve.")
            .font(.footnote).foregroundStyle(.secondary)
          VStack(spacing: 8) {
            ReviewButton("Approve and call", prominent: true) { model.callCommand("confirm", callID: call.id) }
            ReviewButton("Cancel", role: .cancel) { model.callCommand("cancel", callID: call.id) }
          }
        } else {
          Text(call.status.replacingOccurrences(of: "_", with: " ")).font(.headline)
          if call.status == "uncertain" || model.confirmationUnknown(for: call) && call.status == "pending" {
            Text("The result could not be verified. Check with the business before making another booking. Jolly will not redial automatically.").font(.footnote)
          }
          VStack(spacing: 8) {
            if call.active || call.status == "uncertain" || model.confirmationUnknown(for: call) && call.status == "pending" {
              ReviewButton(call.status == "uncertain" ? "Try stopping call" : "Stop call", role: .destructive) { model.callCommand("stop", callID: call.id) }
            }
            if (call.booked || call.bookingCancelled) && call.supersededBy == nil {
              ReviewButton(call.bookingCancelled ? "Review Calendar removal" : "Review Calendar event", prominent: true) { model.callCommand("calendar", callID: call.id) }
                .disabled(model.hasProposal)
              if model.hasProposal {
                Text("Finish your current proposal review before preparing this Calendar event.").font(.footnote)
              }
            }
            if call.booked && call.supersededBy == nil {
              ReviewButton("Reschedule booking") { changingTime = true }.disabled(model.hasProposal)
              ReviewButton("Cancel booking", role: .destructive) { cancellingBooking = true }.disabled(model.hasProposal)
            }
            ReviewButton("Refresh status") { model.callCommand("refresh", callID: call.id) }
            ReviewButton("Back to Jolly") { model.dismissCallCompletion(); close() }
          }
        }
        if model.callUpdating { ProgressView("Updating…").frame(maxWidth: .infinity) }
      }.padding().frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true).disabled(model.callUpdating)
    }.onAppear { model.resumeCalls(); model.loadLinkedCalendarAction(call) }
      .sheet(isPresented: $changingTime) {
        NavigationStack {
          Form {
            Section {
              DatePicker("Earliest start", selection: $windowStart, in: Date()..., displayedComponents: [.date, .hourAndMinute])
              DatePicker("Available until", selection: $windowEnd, in: windowStart..., displayedComponents: [.date, .hourAndMinute])
              Text("Times use \(call.booking.timeZone). Jolly will prepare a new call for your approval. The existing booking stays unchanged until the business confirms a change.").font(.footnote)
            }
            Button("Prepare reschedule call") {
              model.prepareBookingChange(call, operation: "reschedule", start: windowStart, end: windowEnd)
              changingTime = false
            }.disabled(windowEnd <= windowStart || windowStart <= Date())
          }.environment(\.timeZone, TimeZone(identifier: call.booking.timeZone) ?? .current)
            .navigationTitle("Reschedule")
        }
      }
      .confirmationDialog("Prepare a cancellation call?", isPresented: $cancellingBooking, titleVisibility: .visible) {
        Button("Prepare cancellation") { model.prepareBookingChange(call, operation: "cancel_booking") }
      } message: {
        Text("You will review and approve the call before Jolly asks the business to cancel. Calendar removal needs a separate approval.")
      }
  }
}


/// A completion never speaks over a conversation or grants Calendar write permission.
struct BookingCompletionCard: View {
  let call: CallAction
  let review: () -> Void
  let dismiss: () -> Void
  var body: some View {
    #if os(watchOS)
      content.padding(.horizontal, 6).padding(.vertical, 8)
    #else
      content.padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22))
    #endif
  }
  private var content: some View {
    VStack(spacing: 16) {
      VStack(spacing: 6) {
        Image(systemName: call.booked ? "checkmark.circle.fill" : "phone.badge.waveform")
          .font(.system(size: 28, weight: .medium))
          .foregroundStyle(call.booked ? Color.green : Color.secondary)
          .accessibilityHidden(true)
        Text(call.resultTitle)
          .font(.caption).foregroundStyle(.secondary)
      }
      VStack(spacing: 5) {
        Text(call.booking.purpose).font(.headline)
        Text(call.booking.destinationName).font(.subheadline).foregroundStyle(.secondary)
        if let slotText = call.completionDateText(), call.booked {
          Text(slotText).font(.subheadline.weight(.medium)).padding(.top, 3)
        }
        if !call.booked {
          Text(call.summary ?? call.status.replacingOccurrences(of: "_", with: " ")).font(.footnote)
        }
      }.multilineTextAlignment(.center)
      VStack(spacing: 8) {
        ReviewButton("review booking", prominent: true, action: review)
        ReviewButton("done", action: dismiss)
      }
    }
    .frame(maxWidth: .infinity)
    .fixedSize(horizontal: false, vertical: true)
    .accessibilityElement(children: .contain)
  }
}

private struct ReviewDetail: View {
  let title: String
  let value: String
  init(_ title: String, value: String) { self.title = title; self.value = value }
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title).font(.caption).foregroundStyle(.secondary)
      Text(value).font(.body)
    }.frame(maxWidth: .infinity, alignment: .leading)
      .fixedSize(horizontal: false, vertical: true)
  }
}

/// Native capsule controls keep approval and dismissal targets comfortably tappable.
private struct ReviewButton: View {
  let title: String
  let role: ButtonRole?
  let prominent: Bool
  let action: () -> Void
  init(_ title: String, role: ButtonRole? = nil, prominent: Bool = false, action: @escaping () -> Void) {
    self.title = title
    self.role = role
    self.prominent = prominent
    self.action = action
  }
  var body: some View {
    if prominent {
      button.buttonStyle(.borderedProminent).tint(.green).buttonBorderShape(.capsule)
    } else {
      button.buttonStyle(.bordered).buttonBorderShape(.capsule)
    }
  }
  private var button: some View {
    Button(role: role, action: action) {
      Text(title).font(.body.weight(.medium))
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, minHeight: 44)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
