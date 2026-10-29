import MuseCore
import SwiftUI

@main struct MusePhoneApp: App {
  @UIApplicationDelegateAdaptor(PhoneNotificationDelegate.self) private var notificationDelegate
  @State private var store: ConnectionStore
  @State private var phone: PhoneModel
  @State private var conversation: ConversationModel
  private let bridge: PhoneWatchBridge
  init() {
    let store = ConnectionStore()
    _store = State(initialValue: store)
    _phone = State(initialValue: PhoneModel(store: store))
    _conversation = State(initialValue: ConversationModel(store: store))
    bridge = PhoneWatchBridge(store: store)
  }
  var body: some Scene {
    WindowGroup {
      PhoneHome(store: store, model: phone, conversation: conversation, bridge: bridge)
    }
  }
}
struct Connector: Identifiable {
  let id: String, title: String, detail: String
  static let all = [
    Connector(
      id: "google-calendar", title: "Calendar",
      detail: "Let Tuck view your schedule and create meetings—with your approval."),
    Connector(
      id: "instagram", title: "Instagram", detail: "Read posts and comments, and draft replies for you to review."),
    Connector(
      id: "facebook", title: "Facebook Pages", detail: "Read Page posts and comments, and draft replies for you to review."),
    Connector(
      id: "notion", title: "Notion Workspace", detail: "Let Tuck find and organize your notes."),
    Connector(id: "gmail", title: "Gmail Inbox", detail: "Let Tuck help you catch up on email."),
    Connector(id: "safari", title: "Web Search", detail: "Let Tuck look things up for you."),
  ]
}
struct PhoneHome: View {
  let store: ConnectionStore
  let model: PhoneModel
  let conversation: ConversationModel
  let bridge: PhoneWatchBridge
  @Environment(\.scenePhase) private var phase
  @State private var setup = false
  @State private var showingTasks = false
  private let notifications = TaskNotifications.shared
  var body: some View {
    NavigationStack {
      List {
        Section {
          NavigationLink {
            PhoneConversation(model: conversation)
          } label: {
            HStack(spacing: 12) {
              JollyView(mood: .idle).frame(width: 88, height: 88)
                #if DEBUG
                  .onLongPressGesture(minimumDuration: 1.5) { setup = true }
                #endif
              VStack(alignment: .leading, spacing: 5) {
                Text("Tuck").font(.title2.bold()).foregroundStyle(.primary)
                Text("Your favorite Muse, on your wrist.").font(.subheadline).foregroundStyle(
                  .secondary)
              }
            }.padding(.vertical, 6)
          }
        }
        Section {
          Button { showingTasks = true } label: { Label("Tasks", systemImage: "checklist") }
          NavigationLink { MemoryView(model: model) } label: {
            Label("Memory", systemImage: "brain.head.profile")
          }
        }
        Section("Connections") {
          ForEach(Connector.all) { connector in
            HStack(spacing: 10) {
              NavigationLink {
                if ["instagram", "facebook"].contains(connector.id) {
                  SocialConnectionView(provider: connector.id, model: model)
                } else if ["gmail", "notion"].contains(connector.id) {
                  WorkspaceConnectionView(provider: connector.id, model: model)
                } else {
                  ConnectionDetail(connector: connector, model: model)
                }
              } label: {
                HStack(spacing: 12) {
                  Image(connector.id).resizable().scaledToFit().frame(width: 28, height: 28)
                    .accessibilityHidden(true)
                  Text(connector.title).font(.body)
                  Spacer(minLength: 0)
                  if (connector.id == "google-calendar" && model.status?.calendar == "connected") || (connector.id == "gmail" && model.status?.gmail == "connected") || (connector.id == "notion" && model.status?.notion == "connected") || (["instagram", "facebook"].contains(connector.id) && model.socialConnected(connector.id)) {
                    Circle().fill(.green).frame(width: 6, height: 6).accessibilityLabel("Connected")
                  }
                }.frame(minHeight: 32)
              }
              if connector.id == "google-calendar" {
                Toggle(
                  "Enable Calendar",
                  isOn: Binding(
                    get: {
                      model.status?.calendar == "connected" && model.status?.calendarEnabled == true
                    }, set: { value in Task { await model.enable(value) } })
                )
                .labelsHidden().disabled(model.busy || model.status?.calendar != "connected")
              }
            }
          }
        }
        if let error = model.error ?? store.error {
          Section { Text(error).font(.footnote).foregroundStyle(.secondary) }
        }
      }
      .listStyle(.insetGrouped).navigationTitle("your companion")
      .refreshable { await model.refresh() }
      .task { notifications.configure(store.connection); await model.refresh(); conversation.resumeCalls(); if notifications.openedTaskID != nil || notifications.openedReminderID != nil { showingTasks = true } }
      .onChange(of: store.connection) { _, _ in model.connectionChanged(); conversation.connectionChanged(); notifications.configure(store.connection); conversation.resumeCalls(); Task { await model.refresh() } }
      .onChange(of: notifications.openedReminderID) { _, id in if id != nil { showingTasks = true } }
      .onChange(of: notifications.openedTaskID) { _, id in if id != nil { showingTasks = true } }
      .navigationDestination(isPresented: $showingTasks) { PhoneTasksView(model: conversation) }
      .onChange(of: phase) { _, new in
        if new == .active {
          Task { await model.refresh(); await notifications.refresh() }
          conversation.resumeCalls()
          bridge.publish()
        } else {
          conversation.suspend()
        }
      }
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Button("Connection", systemImage: "link") { setup = true }
              .accessibilityHint("Pair your private backend and sync with Apple Watch")
          }
        }
        .sheet(isPresented: $setup) {
          DemoSetup(store: store) {
            bridge.publish()
            Task { await model.refresh() }
          }
        }
    }
  }
}
struct ConnectionDetail: View {
  let connector: Connector
  let model: PhoneModel
  @Environment(\.openURL) private var openURL
  @State private var confirmDisconnect = false
  @State private var awaitingConsent = false
  var body: some View {
    Form {
      Section {
        HStack {
          Spacer()
          Image(connector.id).resizable().scaledToFit().frame(width: 56, height: 56)
          Spacer()
        }.listRowBackground(Color.clear)
        Text(connector.detail)
      }
      Section {
        if connector.id == "google-calendar" {
          if model.status?.calendar == "connected" {
            Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            Button("Reconnect with Google") { connect() }.disabled(model.busy)
            Button("Disconnect", role: .destructive) { confirmDisconnect = true }.disabled(
              model.busy)
          } else {
            Button("Connect with Google") { connect() }.disabled(model.busy)
            if awaitingConsent {
              Text("Finish signing in with Google, then return here.").font(.footnote)
                .foregroundStyle(.secondary)
            }
          }
        } else if connector.id == "safari", model.status?.webSearch == true {
          Label("Available through Meta", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
          Text("Ask Tuck about current information. Sources appear with the reply; no extra sign-in needed.").font(.footnote)
        } else {
          Text(connector.id == "safari" ? "Web search is unavailable right now. Try again later." : "This connection is unavailable right now. Try again later.").foregroundStyle(.secondary)
        }
        if model.busy { ProgressView() }
      }
      if let error = model.error { Section { Text(error).foregroundStyle(.secondary) } }
    }
    .navigationTitle(connector.title).navigationBarTitleDisplayMode(.inline)
    .confirmationDialog("Disconnect Google Calendar?", isPresented: $confirmDisconnect) {
      Button("Disconnect", role: .destructive) { Task { await model.disconnect() } }
    }
    .task(id: awaitingConsent) {
      guard awaitingConsent else { return }
      for _ in 0..<120 {
        try? await Task.sleep(for: .seconds(3))
        guard !Task.isCancelled else { return }
        await model.refresh()
        if model.status?.calendar == "connected" {
          awaitingConsent = false
          return
        }
      }
      awaitingConsent = false
    }
  }
  private func connect() {
    Task {
      if let url = await model.connect() {
        awaitingConsent = true
        openURL(url)
      }
    }
  }
}
struct PhoneConversation: View {
  let model: ConversationModel
  @State private var review = false
  @State private var callReview = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        if model.completionCall == nil {
          Button {
            if model.hasProposal { review = true } else { model.tap() }
          } label: {
            JollyView(mood: model.mood, level: model.level, heartStart: model.heartStart)
              .frame(width: 260, height: 260)
          }.buttonStyle(.plain).accessibilityLabel(
            model.recording ? "Finish speaking" : "Talk to Tuck")
          Text(model.caption).font(.subheadline)
        }
        if let failure = model.failure {
          Text(failure).font(.footnote).foregroundStyle(.secondary).padding(.horizontal)
        }
        if let call = model.completionCall {
          BookingCompletionCard(call: call, review: { callReview = true }, dismiss: { model.dismissCallCompletion() })
            .padding(.horizontal)
        } else if let status = model.callStatusText {
          Button { callReview = true } label: {
            Label(status, systemImage: model.backgroundCall?.active == true ? "phone.connection" : "phone")
              .font(.footnote)
          }.accessibilityHint("Review booking progress or stop the call")
        }
        if model.hasProposal { Button("Review proposal") { review = true } }
        ForEach(model.activities) { entry in
          VStack(alignment: .leading, spacing: 4) {
            HStack {
              Text(entry.kind).font(.caption.bold())
              Spacer()
              Text(entry.time, style: .time).font(.caption).foregroundStyle(.secondary)
            }
            Text(entry.text).font(.subheadline)
            ForEach(entry.sources) { source in
              if let url = source.safeURL { Link(source.title, destination: url).font(.footnote) }
            }
          }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal)
          Divider().padding(.leading)
        }
      }
    }.animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: model.completionCall?.id)
      .navigationTitle("Tuck").navigationBarTitleDisplayMode(.inline)
      .sheet(isPresented: $review) {
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
      .sheet(isPresented: $callReview, onDismiss: { if model.hasProposal { review = true } }) {
        if let call = model.backgroundCall { CallReview(model: model, call: call) }
      }
      .onChange(of: model.proposalID) { _, value in
        if value == nil { review = false }
        else if callReview { callReview = false }
      }
      .onAppear { model.resumeCalls() }
      .onDisappear { model.suspend() }
  }
}

struct WorkspaceConnectionView: View {
  let provider: String
  let model: PhoneModel
  @Environment(\.openURL) private var openURL
  @Environment(\.scenePhase) private var phase
  @State private var disconnecting = false
  @State private var query = ""
  private var connected: Bool { (provider == "gmail" ? model.status?.gmail : model.status?.notion) == "connected" }
  var body: some View {
    Form {
      Section {
        Text(provider == "gmail" ? "Let Tuck find and summarize your email. Enable drafts separately to save reviewed, unsent drafts. Tuck never sends email." : "Let Tuck turn ideas and email summaries into pages. Review every draft before saving.")
        if connected { Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
        Button(connected ? "Reconnect" : (provider == "gmail" ? "Connect with Google" : "Connect with Notion")) {
          Task { if let url = await model.connectWorkspace(provider) { openURL(url) } }
        }.disabled(model.busy)
        if connected { Button("Disconnect", role: .destructive) { disconnecting = true }.disabled(model.busy) }
      }
      if provider == "gmail", connected {
        Section("Email drafts") {
          if model.status?.gmailDraftsEnabled == true { Label("Draft saving enabled", systemImage: "checkmark.circle") }
          else { Button("Enable Gmail drafts") { Task { if let url = await model.connectWorkspace("gmail", drafts: true) { openURL(url) } } }.disabled(model.busy) }
          Text("Every draft requires your review before saving to Gmail.").font(.footnote)
        }
      }
      if provider == "notion", connected {
        Section {
          if let parent = model.status?.notionParent { Label(parent.title, systemImage: "folder") }
          TextField("Find a shared page", text: $query).onSubmit { Task { await model.loadNotionPages(query) } }
          Button("Find pages") { Task { await model.loadNotionPages(query) } }.disabled(model.busy)
          ForEach(model.notionPages) { page in
            Button { Task { await model.chooseNotionPage(page.id) } } label: {
              HStack { Text(page.title); Spacer(); if model.status?.notionParent?.id == page.id { Image(systemName: "checkmark") } }
            }.disabled(model.busy)
          }
          if model.notionHasMore { Text("More pages are available. Narrow your search.").font(.footnote).foregroundStyle(.secondary) }
        } header: { Text("Save pages under") } footer: { Text("Choose a page shared with Muse. Anyone who can access that page may also see documents saved beneath it.") }
      }
      if let error = model.error { Section { Text(error).font(.footnote).foregroundStyle(.red) } }
    }
    .navigationTitle(provider == "gmail" ? "Gmail" : "Notion")
    .task { await model.refresh(); if provider == "notion", connected { await model.loadNotionPages("") } }
    .onChange(of: phase) { _, new in if new == .active { Task { await model.refresh(); if provider == "notion", connected { await model.loadNotionPages(query) } } } }
    .confirmationDialog("Disconnect this service?", isPresented: $disconnecting, titleVisibility: .visible) {
      Button("Disconnect", role: .destructive) { Task { await model.disconnectWorkspace(provider) } }
    }
  }
}

struct SocialConnectionView: View {
  let provider: String
  let model: PhoneModel
  @Environment(\.openURL) private var openURL
  @Environment(\.scenePhase) private var phase
  @State private var disconnecting = false
  @State private var awaitingConsent = false
  private var connected: Bool { model.socialConnected(provider) }
  private var accounts: [SocialAccount] { model.socialAccounts[provider] ?? [] }
  var body: some View {
    Form {
      Section {
        Text("Let Tuck read posts and comments, and draft replies for you to review. Tuck can’t publish posts or send replies.")
        if connected, let selected = model.selectedSocialAccount(provider) {
          Label("Connected to \(selected.name)", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        } else {
          Text("Sign in with Facebook, then choose an account to finish connecting.")
        }
        Button(connected ? "Reconnect with Facebook" : "Connect with Facebook") {
          Task {
            if let url = await model.connectWorkspace(provider) {
              awaitingConsent = true
              openURL(url)
            }
          }
        }.disabled(model.busy)
        if awaitingConsent {
          Text("Finish signing in, then return here and choose an account.").font(.footnote)
        }
        Button("Disconnect", role: .destructive) { disconnecting = true }.disabled(model.busy)
      }
      Section {
        Button("Refresh accounts") { Task { await model.loadSocialAccounts(provider) } }.disabled(model.busy)
        ForEach(accounts) { account in
          Button { Task { await model.chooseSocialAccount(provider, id: account.id); if connected { awaitingConsent = false } } } label: {
            HStack {
              Text(account.name)
              Spacer()
              if connected, model.selectedSocialAccount(provider)?.id == account.id { Image(systemName: "checkmark") }
            }
          }.disabled(model.busy)
        }
        if accounts.isEmpty {
          Text("No accounts listed. Sign in and refresh to see accounts you can choose.").font(.footnote).foregroundStyle(.secondary)
        }
      } header: { Text(provider == "instagram" ? "Choose an Instagram account" : "Choose a Facebook Page") }
      if model.busy { ProgressView() }
      if let error = model.error { Section { Text(error).font(.footnote).foregroundStyle(.red) } }
    }
    .navigationTitle(provider == "instagram" ? "Instagram" : "Facebook Pages")
    .task { await model.refresh(); await model.loadSocialAccounts(provider, quietly: true) }
    .onChange(of: phase) { _, new in
      if new == .active { Task { await model.refresh(); await model.loadSocialAccounts(provider, quietly: !awaitingConsent) } }
    }
    .confirmationDialog("Disconnect this service?", isPresented: $disconnecting, titleVisibility: .visible) {
      Button("Disconnect", role: .destructive) {
        Task { await model.disconnectWorkspace(provider); awaitingConsent = false }
      }
    }
  }
}
