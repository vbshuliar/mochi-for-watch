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
    guard WCSession.default.activationState == .activated, let connection = store.connection else {
      return
    }
    do {
      let data = try JSONEncoder().encode(connection)
      try WCSession.default.updateApplicationContext(["connection": data])
    } catch { store.error = "Couldn’t send setup to your Watch. Open both apps and try again." }
  }
  nonisolated func session(
    _ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    let received = session.receivedApplicationContext["connection"] as? Data
    Task { @MainActor in
      if error != nil {
        store.error = "Watch pairing is unavailable. Open both apps and try again."
        return
      }
      #if os(iOS)
        publish()
      #else
        if let received { receive(received) }
      #endif
    }
  }
  nonisolated func session(
    _ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    guard let data = applicationContext["connection"] as? Data else { return }
    Task { @MainActor in receive(data) }
  }
  private func receive(_ data: Data) {
    do { try store.save(JSONDecoder().decode(Connection.self, from: data)) } catch {
      store.error = "Couldn’t read the connection from your iPhone."
    }
  }
  #if os(iOS)
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
  #endif
}
