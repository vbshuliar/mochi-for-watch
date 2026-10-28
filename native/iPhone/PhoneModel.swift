import Foundation
import MuseCore
import Observation

@MainActor @Observable final class PhoneModel {
  var status: ServerStatus?
  var notionPages: [NotionPage] = []
  var notionHasMore = false
  var memories: [SavedMemory] = []
  var memoryError: String?
  var memoryBusy = false
  private var memoryGeneration = 0
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
  func loadMemories() async {
    memoryGeneration += 1
    let generation = memoryGeneration
    let connection = store.connection
    do {
      let loaded = try await client().get("v1/memories", as: MemoryList.self).memories
      guard generation == memoryGeneration, connection == store.connection else { return }
      memories = loaded
      memoryError = nil
    } catch {
      guard generation == memoryGeneration, connection == store.connection else { return }
      memoryError = error.localizedDescription
    }
  }
  func saveMemory(id: String?, title: String, text: String) async -> Bool {
    guard !memoryBusy else { return false }
    memoryGeneration += 1
    memoryBusy = true
    defer { memoryBusy = false }
    do {
      _ = try await client().json(id.map { "v1/memories/\($0)" } ?? "v1/memories",
        method: id == nil ? "POST" : "PATCH", values: ["title": title, "text": text])
      await loadMemories()
      return memoryError == nil
    } catch { memoryError = error.localizedDescription; return false }
  }
  func forgetMemory(id: String?) async -> Bool {
    guard !memoryBusy else { return false }
    memoryGeneration += 1
    memoryBusy = true
    defer { memoryBusy = false }
    do {
      _ = try await client().data(id.map { "v1/memories/\($0)" } ?? "v1/memories", method: "DELETE")
      await loadMemories()
      return memoryError == nil
    } catch { memoryError = error.localizedDescription; return false }
  }
  func connectWorkspace(_ provider: String) async -> URL? {
    guard !busy, ["gmail", "notion"].contains(provider) else { return nil }
    busy = true; defer { busy = false }
    do {
      struct Link: Decodable { let url: URL }
      let bytes = try await client().json("v1/integrations/\(provider)/connect", values: [:])
      let url = try JSONDecoder().decode(Link.self, from: bytes).url
      guard url.scheme == "https", url.host == (provider == "gmail" ? "accounts.google.com" : "api.notion.com") else { throw MuseError.message("Invalid sign-in link.") }
      error = nil; return url
    } catch { self.error = "Connection isn’t available right now. Please try again later."; return nil }
  }
  func disconnectWorkspace(_ provider: String) async {
    guard !busy, ["gmail", "notion"].contains(provider) else { return }
    busy = true; defer { busy = false }
    do {
      _ = try await client().data("v1/integrations/\(provider)", method: "DELETE")
      if provider == "notion" { notionPages = []; notionHasMore = false }
      await refresh()
    } catch { self.error = error.localizedDescription }
  }
  func loadNotionPages(_ query: String) async {
    guard !busy else { return }
    busy = true; defer { busy = false }
    do {
      // APIClient paths are path components, so the query is sent through a POST search endpoint.
      let bytes = try await client().json("v1/integrations/notion/pages/search", values: ["query": query])
      let result = try JSONDecoder().decode(NotionPages.self, from: bytes)
      notionPages = result.pages; notionHasMore = result.hasMore; error = nil
    } catch { self.error = error.localizedDescription }
  }
  func chooseNotionPage(_ id: String) async {
    guard !busy else { return }
    busy = true; defer { busy = false }
    do {
      _ = try await client().json("v1/integrations/notion/destination", method: "PUT", values: ["id": id])
      await refresh()
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
