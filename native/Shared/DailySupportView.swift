import SwiftUI
import MochiCore

struct GmailDraftReview: View {
  let action: GmailDraftAction
  let busy: Bool
  let decide: (Bool) -> Void
  let close: () -> Void
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Text("Review email draft").font(.headline)
        Text("To: \(action.to)")
        Text(action.subject).font(.headline)
        Text(action.body)
        Text("Saves an unsent draft in Gmail. No email is sent.").font(.footnote).foregroundStyle(.secondary)
        if action.status == "pending" || action.status == "uncertain" {
          if action.status == "uncertain" { Text("The previous save could not be confirmed. Verify its status before continuing.") }
          Button(action.status == "uncertain" ? "Verify saved draft" : "Save draft") { decide(true) }.disabled(busy)
          if action.status == "pending" { Button("Cancel draft", role: .destructive) { decide(false) }.disabled(busy) }
        } else { Text(action.status == "executing" ? "Saving draft…" : "Draft \(action.status)") }
        Button("Back", action: close).disabled(busy)
      }.padding()
    }
  }
}

struct DailySupportView: View {
  let model: DailySupportModel
  @State private var selectedDraft: String?
  @State private var creating = false
  @State private var title = ""
  @State private var due = Date().addingTimeInterval(3600)
  @State private var recurrence = "none"
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      List {
        Section("Daily briefing") {
          if let briefing = model.briefing {
            Text(briefing.summary)
            if briefing.simulated { Text("Demo information").font(.caption).foregroundStyle(.secondary) }
            ForEach(briefing.sources.keys.sorted(), id: \.self) { source in
              if let status = briefing.sources[source], status != "available" {
                Text("\(source.capitalized): \(status)").font(.caption).foregroundStyle(.secondary)
              }
            }
          } else { Text("Refresh to see your day.").foregroundStyle(.secondary) }
        }
        Section("Mochi reminders") {
          ForEach(model.reminders) { reminder in
            VStack(alignment: .leading, spacing: 6) {
              Text(reminder.title).font(.headline)
              Text("\(reminder.formattedDueAt) · \(reminder.timeZone)").font(.caption)
              if reminder.recurrence != "none" { Text("Repeats \(reminder.recurrence)").font(.caption) }
              if reminder.status == "pending" {
                Button("Complete") { Task { await model.updateReminder(reminder, values: ["status": "completed"]) } }
                Button("Snooze one hour") { Task { await model.updateReminder(reminder, values: ["dueAt": ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600))]) } }
              } else { Text("Completed").font(.caption) }
              Button("Delete", role: .destructive) { Task { await model.deleteReminder(reminder) } }
            }
          }
          if model.reminders.isEmpty { Text("Ask Mochi to remind you, or add a reminder.") }
          Button("Add reminder") { model.beginReminder(); creating = true }
          Text("Stored in Mochi; separate from Apple Reminders.").font(.caption).foregroundStyle(.secondary)
        }
        Section("Gmail drafts") {
          ForEach(model.drafts) { draft in
            Button { selectedDraft = draft.id } label: {
              VStack(alignment: .leading) { Text(draft.subject); Text("\(draft.to) · \(draft.status)").font(.caption).foregroundStyle(.secondary) }
            }
          }
          if model.drafts.isEmpty { Text("Ask Mochi to draft an email. Review it here before saving to Gmail.") }
        }
        if let error = model.error { Text(error).foregroundStyle(.red) }
        Button("Refresh") { Task { await model.refresh() } }
      }.disabled(model.busy)
        .overlay { if model.busy { ProgressView() } }
        .navigationTitle("Today")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        .task { await model.refresh() }
        .sheet(isPresented: Binding(get: { selectedDraft != nil }, set: { if !$0 { selectedDraft = nil } })) {
          if let draft = model.drafts.first(where: { $0.id == selectedDraft }) {
            GmailDraftReview(action: draft, busy: model.busy, decide: { confirm in Task { await model.decideDraft(draft, confirm: confirm) } }, close: { selectedDraft = nil })
          }
        }
        .sheet(isPresented: $creating) {
          NavigationStack {
            Form {
              TextField("Reminder", text: $title)
              DatePicker("When", selection: $due, in: Date()...)
              Picker("Repeat", selection: $recurrence) { Text("Never").tag("none"); Text("Daily").tag("daily"); Text("Weekly").tag("weekly") }
              Button("Save reminder") { Task { await model.createReminder(title: title, due: due, recurrence: recurrence); if model.error == nil { creating = false; title = "" } } }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy)
              if let error = model.error { Text(error).foregroundStyle(.red) }
              Button("Cancel") { creating = false }
            }.navigationTitle("Reminder")
          }
        }
    }
  }
}

struct BookingProfileView: View {
  let model: DailySupportModel
  @State private var profile = BookingProfile()
  @State private var loaded = false
  @Environment(\.dismiss) private var dismiss
  private let days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  var body: some View {
    NavigationStack {
      Form {
        Section("My usual haircut") {
          TextField("Barber or salon", text: $profile.destinationName)
          TextField("Phone including country code", text: $profile.phoneNumber)
          TextField("Service", text: $profile.purpose)
          TextField("Booking name", text: $profile.customerName)
          Stepper("\(profile.durationMinutes) minutes", value: $profile.durationMinutes, in: 5...240, step: 5)
        }
        Section("Preferred times") {
          ForEach(1...7, id: \.self) { day in
            Toggle(days[day - 1], isOn: Binding(get: { profile.preferredDays.contains(day) }, set: { selected in
              if selected { profile.preferredDays = Array(Set(profile.preferredDays + [day])).sorted() }
              else { profile.preferredDays.removeAll { $0 == day } }
            }))
          }
          TextField("From, HH:mm", text: $profile.preferredStart)
          TextField("Until, HH:mm", text: $profile.preferredEnd)
          TextField("Time zone", text: $profile.timeZone)
        }
        Section {
          Text("These details help Mochi prepare your usual booking. You still review and approve each call. Saving a number does not enable it for calling.").font(.footnote)
          if !loaded { Button("Load preferences") { Task { if await model.loadProfile() { profile = model.profile ?? BookingProfile(); loaded = true } } } }
          Button("Save preferences") { Task { if await model.saveProfile(profile) { dismiss() } } }.disabled(!loaded || profile.destinationName.trimmingCharacters(in: .whitespaces).isEmpty || profile.phoneNumber.isEmpty || profile.customerName.isEmpty || profile.preferredDays.isEmpty)
          if model.profile != nil { Button("Forget booking preferences", role: .destructive) { Task { if await model.saveProfile(nil) { dismiss() } } } }
          if let error = model.error { Text(error).foregroundStyle(.red) }
        }
      }.disabled(model.busy)
        .navigationTitle("My usual haircut")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        .task { if await model.loadProfile() { profile = model.profile ?? BookingProfile(); loaded = true } }
    }
  }
}

struct DemoReadinessView: View {
  let model: DailySupportModel
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      List {
        if let readiness = model.readiness {
          Section {
            Text(readiness.configurationReady ? "Configuration ready" : "Setup needs attention").font(.headline)
            Text("\(readiness.mode.capitalized) · revision \(readiness.revision)").font(.caption)
            Text("Updated \(Date(timeIntervalSince1970: readiness.checkedAt / 1000).formatted())").font(.caption)
            Text("Configuration checks do not prove a successful real call or device delivery.").font(.footnote)
          }
          ForEach(readiness.checks) { check in
            Section(check.title) {
              Label(check.status.replacingOccurrences(of: "_", with: " "), systemImage: check.status == "ready" ? "checkmark.circle" : "info.circle")
              Text(check.detail).font(.footnote)
            }
          }
          Section("Today's calls") {
            Text("\(readiness.usage.callAttempts) of \(readiness.usage.callLimit) attempts used")
            Text("\(readiness.usage.remainingCalls) remaining · \(readiness.usage.activeCalls) active · \(readiness.usage.unverifiedCalls) unverified").font(.footnote)
            Text(readiness.usage.notes).font(.footnote)
          }
        }
        if let error = model.error { Text(error).foregroundStyle(.red) }
        Button("Refresh readiness") { Task { await model.loadReadiness() } }.disabled(model.busy)
      }.navigationTitle("Demo readiness")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        .task { await model.loadReadiness() }
    }
  }
}
