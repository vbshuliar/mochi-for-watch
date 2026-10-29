import MuseCore
import SwiftUI

struct PhoneTasksView: View {
  let model: ConversationModel
  @State private var selectedID: String?
  @State private var showingDaily = false
  @State private var reviewCall = false
  @State private var reviewProposal = false
  private let notifications = TaskNotifications.shared
  var body: some View {
    List {
      Section {
        ForEach(model.taskCalls.sorted { ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0) }) { call in
          Button {
            selectedID = call.id
            reviewCall = true
          } label: {
            VStack(alignment: .leading, spacing: 5) {
              Text(call.booking.purpose).font(.headline)
              Text(call.booking.destinationName).foregroundStyle(.secondary)
              Text(call.progress?.text ?? call.resultTitle).font(.footnote)
            }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          }
        }
        if model.taskCalls.isEmpty && !model.tasksLoadFailed {
          Text("No current tasks. Bookings started on either device appear here.")
            .foregroundStyle(.secondary)
        }
        if model.tasksLoadFailed {
          Text("Couldn’t refresh tasks. Showing the last known status.").foregroundStyle(.secondary)
        }
        Button("Refresh tasks") { model.resumeCalls(); Task { await notifications.refresh() } }
        if model.hasProposal { Button("Review proposal") { reviewProposal = true } }
      }
      Section { Button("Today · briefing, reminders & drafts") { showingDaily = true } }
      Section("Notifications") {
        Text(notifications.status).font(.footnote).foregroundStyle(.secondary)
        Button(notifications.optedIn ? "Turn off task notifications" : "Enable task notifications") {
          Task { if notifications.optedIn { await notifications.disable() } else { await notifications.enable() } }
        }.disabled(notifications.busy)
      }
    }.navigationTitle("Tasks")
      .task { model.resumeCalls(); await notifications.refresh(); openNotificationTask() }
      .onChange(of: notifications.openedTaskID) { _, _ in openNotificationTask() }
      .sheet(isPresented: $showingDaily) { DailySupportView(model: model.daily) }
      .onChange(of: notifications.openedReminderID) { _, id in if id != nil { showingDaily = true; notifications.openedReminderID = nil } }
      .sheet(isPresented: $reviewCall, onDismiss: { if model.hasProposal { reviewProposal = true } }) {
        if let call = model.taskCalls.first(where: { $0.id == selectedID }) {
          CallReview(model: model, call: call)
        } else {
          VStack(spacing: 16) {
            Text(model.tasksLoadFailed ? "Couldn’t load this task" : "Loading task…")
            Button("Refresh") { model.resumeCalls() }
          }.padding()
        }
      }
      .sheet(isPresented: $reviewProposal) {
        if let action = model.action { ActionReview(action: action, busy: model.deciding) { model.decide($0) } }
        else if let draft = model.gmailDraftAction { GmailDraftReview(action: draft, busy: model.deciding, decide: { model.decide($0) }, close: { model.dismissGmailDraft() }) }
        else if let document = model.documentAction { DocumentReview(dismiss: { model.dismissDocument() }, action: document, busy: model.deciding) { model.decide($0) } }
        else if let call = model.callAction { CallReview(model: model, call: call) }
      }
      .onChange(of: model.proposalID) { _, value in
        if value == nil { reviewProposal = false }
        else { reviewCall = false; reviewProposal = true }
      }
  }
  private func openNotificationTask() {
    if notifications.openedReminderID != nil { showingDaily = true; notifications.openedReminderID = nil }
    guard let id = notifications.openedTaskID else { return }
    selectedID = id
    notifications.openedTaskID = nil
    model.resumeCalls()
    reviewCall = true
  }
}
