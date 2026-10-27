import Foundation
import MuseCore
import Observation

@MainActor @Observable final class PhoneModel {
  var status: ServerStatus?
  var busy = false
  var error: String?
  let store: ConnectionStore
  init(store: ConnectionStore) { self.store = store }
  private func client() throws -> APIClient {
    guard let connection = store.connection else {
      throw MuseError.message("Connect this app to your demo first.")
    }
    return APIClient(connection: connection)
  }
  func refresh() async {
    guard store.connection != nil else { return }
    do {
      status = try await client().get("v1/status", as: ServerStatus.self)
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  func connect() async -> URL? {
    guard !busy else { return nil }
    busy = true
    defer { busy = false }
    do {
      struct Link: Decodable { let url: URL }
      let bytes = try await client().json("v1/integrations/google/connect", values: [:])
      let url = try JSONDecoder().decode(Link.self, from: bytes).url
      guard url.scheme == "https", url.host == "accounts.google.com" else {
        throw MuseError.message("The sign-in link was not valid.")
      }
      error = nil
      return url
    } catch {
      self.error = "Calendar sign-in isn’t available right now. Please try again later."
      return nil
    }
  }
  func enable(_ enabled: Bool) async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    do {
      _ = try await client().data(
        "v1/integrations/google", method: "PATCH", body: JSONEncoder().encode(["enabled": enabled]))
      await refresh()
    } catch { self.error = error.localizedDescription }
  }
  func disconnect() async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    do {
      _ = try await client().data("v1/integrations/google", method: "DELETE")
      await refresh()
    } catch { self.error = error.localizedDescription }
  }
}
