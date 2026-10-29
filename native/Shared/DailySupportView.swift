import SwiftUI
import MuseCore

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
        Section("Jolly reminders") {
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
          if model.reminders.isEmpty { Text("Ask Jolly to remind you, or add a reminder.") }
          Button("Add reminder") { model.beginReminder(); creating = true }
          Text("Stored in Jolly; separate from Apple Reminders.").font(.caption).foregroundStyle(.secondary)
        }
        Section("Gmail drafts") {
          ForEach(model.drafts) { draft in
            Button { selectedDraft = draft.id } label: {
              VStack(alignment: .leading) { Text(draft.subject); Text("\(draft.to) · \(draft.status)").font(.caption).foregroundStyle(.secondary) }
            }
          }
          if model.drafts.isEmpty { Text("Ask Jolly to draft an email. Review it here before saving to Gmail.") }
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
