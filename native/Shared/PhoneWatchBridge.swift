import Foundation
import MochiCore
import WatchConnectivity

@MainActor final class PhoneWatchBridge: NSObject, WCSessionDelegate {
  let store: ConnectionStore
  init(store: ConnectionStore) {
    self.store = store
    super.init()
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }
  func publish() {
    guard WCSession.default.activationState == .activated else {
      return
    }
    do {
      var context: [String: Any] = ["mochiColour": store.mochiColour.rawValue]
      if let connection = store.connection {
        context["connection"] = try JSONEncoder().encode(connection)
      }
      try WCSession.default.updateApplicationContext(context)
    } catch { store.error = "Couldn’t sync with your Watch. Open both apps and try again." }
  }
  nonisolated func session(
    _ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    let received = session.receivedApplicationContext["connection"] as? Data
    let colour = session.receivedApplicationContext["mochiColour"] as? String
    Task { @MainActor in
      if error != nil {
        store.error = "Watch pairing is unavailable. Open both apps and try again."
        return
      }
      #if os(iOS)
        publish()
      #else
        store.receiveColour(colour)
        if let received { receive(received) }
      #endif
    }
  }
  nonisolated func session(
    _ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    let data = applicationContext["connection"] as? Data
    let colour = applicationContext["mochiColour"] as? String
    Task { @MainActor in
      #if os(watchOS)
        store.receiveColour(colour)
      #endif
      if let data { receive(data) }
    }
  }
  private func receive(_ data: Data) {
    do {
      let connection = try JSONDecoder().decode(Connection.self, from: data)
      if store.connection != connection { try store.save(connection) }
    } catch {
      store.error = "Couldn’t read the connection from your iPhone."
    }
  }
  #if os(iOS)
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
  #endif
}
