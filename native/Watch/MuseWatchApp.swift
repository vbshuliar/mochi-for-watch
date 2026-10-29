import MuseCore
import SwiftUI
import WatchKit

@main struct MuseWatchApp: App {
  @WKApplicationDelegateAdaptor(WatchNotificationDelegate.self) private var notificationDelegate
  @State private var store: ConnectionStore
  @State private var conversation: ConversationModel
  private let bridge: PhoneWatchBridge
  init() {
    let store = ConnectionStore()
    _store = State(initialValue: store)
    _conversation = State(initialValue: ConversationModel(store: store))
    bridge = PhoneWatchBridge(store: store)
  }
  var body: some Scene { WindowGroup { WatchHome(model: conversation, store: store) } }
}
struct WatchHome: View {
  let model: ConversationModel
  let store: ConnectionStore
  @Environment(\.scenePhase) private var phase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var reviewing = false
  @State private var callReview = false
  @State private var showingSources = false
  @State private var selectedTaskID: String?
  @State private var page = 0
  @State private var showingDaily = false
  @State private var notificationSettings = false
  private let notifications = TaskNotifications.shared
  var body: some View {
    TabView(selection: $page) {
      jollyPage.tag(0)
      tasksPage.tag(1)
    }
    .tabViewStyle(.page(indexDisplayMode: .always))
    .background(.black)
    .sheet(isPresented: $showingDaily) { DailySupportView(model: model.daily) }
    .onChange(of: notifications.openedReminderID) { _, id in if id != nil { showingDaily = true; notifications.openedReminderID = nil } }
    .sheet(isPresented: $notificationSettings) {
      ScrollView {
        VStack(spacing: 12) {
          Text("Notifications").font(.headline)
          Text(notifications.status).font(.footnote)
          Button(notifications.optedIn ? "Turn off" : "Enable updates") {
            Task { if notifications.optedIn { await notifications.disable() } else { await notifications.enable() } }
          }.disabled(notifications.busy)
        }.padding()
      }.task { await notifications.refresh() }
    }
    .sheet(isPresented: $showingSources) {
      NavigationStack {
        List(model.sources) { source in
          if let url = source.safeURL {
            VStack(alignment: .leading) {
              Text(source.title)
              Text(url.absoluteString).font(.caption2).foregroundStyle(.secondary)
            }
          }
        }.navigationTitle("Sources")
      }
    }
    .sheet(isPresented: $reviewing) {
      if model.action == nil, model.documentAction == nil, model.gmailDraftAction == nil, let call = model.callAction { CallReview(model: model, call: call) }
        if let draft = model.gmailDraftAction {
          GmailDraftReview(action: draft, busy: model.deciding, decide: { model.decide($0) }, close: { model.dismissGmailDraft() })
        }
        if let document = model.documentAction {
          DocumentReview(dismiss: { model.dismissDocument() }, action: document, busy: model.deciding) { model.decide($0) }
        }
        if let action = model.action {
        ActionReview(action: action, busy: model.deciding) { model.decide($0) }
      }
    }
    .onAppear { notifications.configure(store.connection); model.resumeCalls(); openNotificationTask() }
    .sheet(isPresented: $callReview, onDismiss: { if model.hasProposal { reviewing = true } }) {
      if let selectedTaskID {
        if let call = model.taskCalls.first(where: { $0.id == selectedTaskID }) { CallReview(model: model, call: call) }
        else { VStack { Text("Task unavailable or refreshing"); Button("Refresh") { model.resumeCalls() } }.padding() }
      } else if let call = model.backgroundCall { CallReview(model: model, call: call) }
    }
    .onChange(of: model.proposalID) { _, new in
      if new == nil { reviewing = false }
      else if callReview { callReview = false }
    }
    .onChange(of: store.connection) { _, _ in model.connectionChanged(); notifications.configure(store.connection); model.resumeCalls() }
    .onChange(of: notifications.openedTaskID) { _, _ in openNotificationTask() }
    .onChange(of: phase) { _, new in if new != .active { model.suspend() } else { model.resumeCalls(); Task { await notifications.refresh() } } }
  }
  private func openNotificationTask() {
    if notifications.openedReminderID != nil { showingDaily = true; notifications.openedReminderID = nil }
    guard let id = notifications.openedTaskID else { return }
    selectedTaskID = id
    notifications.openedTaskID = nil
    page = 1
    model.resumeCalls()
    callReview = true
  }
  private var jollyPage: some View {
    GeometryReader { geometry in
      VStack(spacing: 0) {
        Spacer(minLength: 0)
        if model.completionCall == nil {
          Button {
            if model.hasProposal { reviewing = true } else { model.tap() }
          } label: {
            JollyView(mood: model.mood, level: model.level, heartStart: model.heartStart)
              .frame(width: geometry.size.width * 0.86, height: geometry.size.width * 0.86)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityLabel(
            model.recording
              ? "Finish speaking" : model.hasProposal ? "Review proposal" : "Talk to Mochi"
          )
          .accessibilityHint(model.caption)
          Button { showingSources = true } label: {
            Text(store.connection == nil ? "open Muse on your iPhone" : model.caption)
            .font(.system(size: 11)).lineLimit(1).minimumScaleFactor(0.85)
            .foregroundStyle(Color(white: 0.88)).padding(.top, 8).padding(.horizontal, 8)
            .accessibilityAddTraits(.updatesFrequently)
          }.buttonStyle(.plain).disabled(model.sources.isEmpty)
            .accessibilityHint(model.sources.isEmpty ? "" : "Tap to view sources for this answer")
        }
        if let call = model.completionCall {
          ScrollView {
            BookingCompletionCard(call: call, review: { selectedTaskID = nil; callReview = true }, dismiss: { model.dismissCallCompletion() })
          }.padding(.horizontal, 4)
        } else if let status = model.callStatusText {
          Button { selectedTaskID = nil; callReview = true } label: {
            Label(status, systemImage: "phone").font(.system(size: 10)).lineLimit(1)
          }.buttonStyle(.plain).padding(.top, 4)
        }
        Spacer(minLength: 10)
      }.animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: model.completionCall?.id)
        .frame(maxWidth: .infinity, maxHeight: .infinity).background(.black)
    }
    .ignoresSafeArea(.container)
    .containerBackground(.black, for: .navigation)
  }
  private var tasksPage: some View {
    TimelineView(.periodic(from: .now, by: 60)) { context in
      let active = model.taskCalls.filter { $0.active }
      let attention = model.taskCalls.filter { $0.needsAttention }
      let recent = model.taskCalls.filter { $0.recentlyCompleted(now: context.date) }
        .sorted { ($0.finishedAt ?? 0) > ($1.finishedAt ?? 0) }
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          Text("Tasks").font(.title3.bold())
          Button("Refresh tasks") { model.resumeCalls(); Task { await notifications.refresh() } }.font(.caption)
          Button("Today") { showingDaily = true }.font(.caption)
          Button("Notifications") { notificationSettings = true }.font(.caption)
          taskSection("In progress", calls: active)
          if !attention.isEmpty || model.action != nil || model.documentAction != nil || model.gmailDraftAction != nil {
            Text("Needs you").font(.caption2).foregroundStyle(.secondary)
            ForEach(attention) { call in taskRow(call) }
            if let action = model.action {
              Button { reviewing = true } label: {
                taskLabel(action.event.title, detail: "Review Calendar event", icon: "calendar")
              }.buttonStyle(.plain)
            }
            if let draft = model.gmailDraftAction { Button(draft.subject) { reviewing = true } }
            if let document = model.documentAction {
              Button { reviewing = true } label: {
                taskLabel(document.title, detail: "Review Notion page", icon: "doc.text")
              }.buttonStyle(.plain)
            }
          }
          taskSection("Recently completed", calls: recent)
          if active.isEmpty && attention.isEmpty && recent.isEmpty && !model.hasProposal && !model.tasksLoadFailed {
            Text("No current tasks").font(.headline)
            Text("Ask Mochi to help with a booking. Recent results appear here for 24 hours.")
              .font(.caption2).foregroundStyle(.secondary)
          }
          if model.tasksLoadFailed {
            Text("Couldn’t refresh tasks. Showing the last known status.")
              .font(.caption2).foregroundStyle(.secondary)
          }
        }.padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 24)
      }
    }
  }
  @ViewBuilder private func taskSection(_ title: String, calls: [CallAction]) -> some View {
    if !calls.isEmpty {
      Text(title).font(.caption2).foregroundStyle(.secondary)
      ForEach(calls) { call in taskRow(call) }
    }
  }
  private func taskRow(_ call: CallAction) -> some View {
    Button { selectedTaskID = call.id; callReview = true } label: {
      taskLabel(call.booking.purpose,
        detail: call.booking.destinationName + " · " + (call.progress?.text ?? call.status.replacingOccurrences(of: "_", with: " ")),
        icon: call.active ? "phone" : call.needsAttention ? "exclamationmark.circle" : "checkmark.circle",
        time: call.taskTimeText())
    }.buttonStyle(.plain)
  }
  private func taskLabel(_ title: String, detail: String, icon: String, time: String? = nil) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: icon).font(.caption).foregroundStyle(.secondary).frame(width: 16)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
        Text(detail).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        if let time { Text(time).font(.caption2).foregroundStyle(.secondary) }
      }
      Spacer(minLength: 0)
    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
      .padding(8).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
      .contentShape(Rectangle())
  }
}
