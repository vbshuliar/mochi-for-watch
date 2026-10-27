import MuseCore
import SwiftUI

@main struct MuseWatchApp: App {
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
  @State private var reviewing = false
  var body: some View {
    GeometryReader { geometry in
      VStack(spacing: 0) {
        Spacer(minLength: 0)
        Button {
          if model.action != nil { reviewing = true } else { model.tap() }
        } label: {
          JollyView(mood: model.mood, level: model.level, heartStart: model.heartStart)
            .frame(width: geometry.size.width * 0.86, height: geometry.size.width * 0.86)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
          model.recording
            ? "Finish speaking" : model.action != nil ? "Review event" : "Talk to Jolly"
        )
        .accessibilityHint(model.caption)
        Text(store.connection == nil ? "open Muse on your iPhone" : model.caption)
          .font(.system(size: 11)).lineLimit(1).minimumScaleFactor(0.85)
          .foregroundStyle(Color(white: 0.88)).padding(.top, 8).padding(.horizontal, 8)
          .accessibilityAddTraits(.updatesFrequently)
        Spacer(minLength: 10)
      }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.black)
    }
    .ignoresSafeArea(.container)
    .containerBackground(.black, for: .navigation)
    .sheet(isPresented: $reviewing) {
      if let action = model.action {
        ActionReview(action: action, busy: model.deciding) { model.decide($0) }
      }
    }
    .onChange(of: model.action?.id) { _, new in if new == nil { reviewing = false } }
    .onChange(of: store.connection) { _, _ in model.connectionChanged() }
    .onChange(of: phase) { _, new in if new != .active { model.suspend() } }
  }
}
