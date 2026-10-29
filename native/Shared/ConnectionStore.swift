import Foundation
import MuseCore
import Observation
import Security

@MainActor @Observable final class ConnectionStore {
  private(set) var connection: Connection?
  var error: String?
  private let service = "com.museforwatch.connection"
  init(connection: Connection? = nil) {
    if let connection {
      self.connection = connection
      return
    }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "backend", kSecReturnData as String: true,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data {
      self.connection = try? JSONDecoder().decode(Connection.self, from: data)
    } else if status != errSecItemNotFound {
      error = "Couldn’t unlock your connection. Please reopen the app."
    }
  }
  func save(_ connection: Connection) throws {
    let data = try JSONEncoder().encode(connection)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "backend",
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
    }
    guard status == errSecSuccess else {
      throw MuseError.message("Couldn’t securely save your connection.")
    }
    self.connection = connection
    error = nil
  }
}

@MainActor @Observable final class PairingModel {
  private let store: ConnectionStore
  private let redeem: (URL, String) async throws -> Connection
  private var generation = UUID()
  var busy = false
  var error: String?
  init(store: ConnectionStore, redeem: @escaping (URL, String) async throws -> Connection = { try await APIClient.redeemPairing(baseURL: $0, code: $1) }) {
    self.store = store; self.redeem = redeem
  }
  func cancel() { generation = UUID(); busy = false }
  func pair(address: String, code: String) async -> Bool {
    guard !busy else { return false }
    let ticket = UUID(); generation = ticket
    let original = store.connection
    busy = true; error = nil
    defer { if generation == ticket { busy = false } }
    do {
      guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw MuseError.message("Enter your backend HTTPS address.") }
      let connection = try await redeem(url, code)
      guard generation == ticket, !Task.isCancelled, store.connection == original else { return false }
      try store.save(connection)
      return true
    } catch {
      guard generation == ticket, !Task.isCancelled, store.connection == original else { return false }
      self.error = error.localizedDescription; return false
    }
  }
}
