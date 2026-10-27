import MuseCore
import SwiftUI

@main struct MusePhoneApp: App {
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
      detail: "Let Jolly view your schedule and create meetings—with your approval."),
    Connector(
      id: "instagram", title: "Instagram", detail: "Let Jolly help with your Instagram posts."),
    Connector(
      id: "facebook", title: "Facebook Pages", detail: "Let Jolly help manage your Facebook Pages."),
    Connector(
      id: "notion", title: "Notion Workspace", detail: "Let Jolly find and organize your notes."),
    Connector(id: "gmail", title: "Gmail Inbox", detail: "Let Jolly help you catch up on email."),
    Connector(id: "safari", title: "Web Search", detail: "Let Jolly look things up for you."),
  ]
}
struct PhoneHome: View {
  let store: ConnectionStore
  let model: PhoneModel
  let conversation: ConversationModel
  let bridge: PhoneWatchBridge
  @Environment(\.scenePhase) private var phase
  @State private var setup = false
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
                Text("Jolly").font(.title2.bold()).foregroundStyle(.primary)
                Text("Your favorite Muse, on your wrist.").font(.subheadline).foregroundStyle(
                  .secondary)
              }
            }.padding(.vertical, 6)
          }
        }
        Section("Connections") {
          ForEach(Connector.all) { connector in
            HStack(spacing: 10) {
              NavigationLink {
                ConnectionDetail(connector: connector, model: model)
              } label: {
                HStack(spacing: 12) {
                  Image(connector.id).resizable().scaledToFit().frame(width: 28, height: 28)
                    .accessibilityHidden(true)
                  Text(connector.title).font(.body)
                  Spacer(minLength: 0)
                  if connector.id == "google-calendar", model.status?.calendar == "connected" {
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
      .task { await model.refresh() }
      .onChange(of: store.connection) { _, _ in conversation.connectionChanged() }
      .onChange(of: phase) { _, new in
        if new == .active {
          Task { await model.refresh() }
          bridge.publish()
        } else {
          conversation.suspend()
        }
      }
      #if DEBUG
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Button("Connection", systemImage: "link") { setup = true }
              .accessibilityHint("Import your private connection and sync with Apple Watch")
          }
        }
        .sheet(isPresented: $setup) {
          DemoSetup(store: store) {
            bridge.publish()
            Task { await model.refresh() }
          }
        }
      #endif
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
        } else {
          Text("This connection isn’t available in this version yet.").foregroundStyle(.secondary)
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
  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        Button {
          if model.action != nil { review = true } else { model.tap() }
        } label: {
          JollyView(mood: model.mood, level: model.level, heartStart: model.heartStart).frame(
            width: 260, height: 260)
        }.buttonStyle(.plain).accessibilityLabel(
          model.recording ? "Finish speaking" : "Talk to Jolly")
        Text(model.caption).font(.subheadline)
        if let failure = model.failure {
          Text(failure).font(.footnote).foregroundStyle(.secondary).padding(.horizontal)
        }
        if model.action != nil { Button("Review event") { review = true } }
        ForEach(model.activities) { entry in
          VStack(alignment: .leading, spacing: 4) {
            HStack {
              Text(entry.kind).font(.caption.bold())
              Spacer()
              Text(entry.time, style: .time).font(.caption).foregroundStyle(.secondary)
            }
            Text(entry.text).font(.subheadline)
          }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal)
          Divider().padding(.leading)
        }
      }
    }.navigationTitle("Jolly").navigationBarTitleDisplayMode(.inline)
      .sheet(isPresented: $review) {
        if let action = model.action {
          ActionReview(action: action, busy: model.deciding) { model.decide($0) }
        }
      }
      .onChange(of: model.action?.id) { _, value in if value == nil { review = false } }
      .onDisappear { model.suspend() }
  }
}
