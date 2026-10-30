import Foundation
import MochiCore
import Observation

@MainActor @Observable final class PhoneModel {
  var status: ServerStatus?
  var notionPages: [NotionPage] = []
  var notionHasMore = false
  var socialAccounts: [String: [SocialAccount]] = [:]
  var memories: [SavedMemory] = []
  var memoryError: String?
  var memoryBusy = false
  private var memoryGeneration = 0
  var busy = false
  var error: String?
  let store: ConnectionStore
  private var connectionGeneration = UUID()
  private let makeClient: (Connection) -> APIClient
  init(store: ConnectionStore, makeClient: @escaping (Connection) -> APIClient = { APIClient(connection: $0) }) {
    self.store = store
    self.makeClient = makeClient
  }
  func connectionChanged() {
    connectionGeneration = UUID()
    memoryGeneration += 1
    status = nil; notionPages = []; notionHasMore = false; socialAccounts = [:]
    memories = []; memoryError = nil; memoryBusy = false; busy = false; error = nil
  }
  private func current(_ connection: Connection?, _ ticket: UUID) -> Bool {
    ticket == connectionGeneration && connection == store.connection
  }
  private func client() throws -> APIClient {
    guard let connection = store.connection else {
      throw MochiError.message("Connect this app to your demo first.")
    }
    return makeClient(connection)
  }
  func refresh() async {
    let connection = store.connection, ticket = connectionGeneration
    guard store.connection != nil else { return }
    do {
      let loaded = try await client().get("v1/status", as: ServerStatus.self)
      guard current(connection, ticket) else { return }
      status = loaded
      error = nil
    } catch {
      guard current(connection, ticket) else { return }
      self.error = "Couldn’t update this connection. Please try again."
    }
  }
  func loadMemories() async {
    let connection = store.connection, ticket = connectionGeneration
    memoryGeneration += 1
    let generation = memoryGeneration
    do {
      let loaded = try await client().get("v1/memories", as: MemoryList.self).memories
      guard generation == memoryGeneration, current(connection, ticket) else { return }
      memories = loaded
      memoryError = nil
    } catch {
      guard generation == memoryGeneration, current(connection, ticket) else { return }
      memoryError = error.localizedDescription
    }
  }
  func saveMemory(id: String?, title: String, text: String) async -> Bool {
    let connection = store.connection, ticket = connectionGeneration
    guard !memoryBusy else { return false }
    memoryGeneration += 1
    memoryBusy = true
    defer { if current(connection, ticket) { memoryBusy = false } }
    do {
      _ = try await client().json(id.map { "v1/memories/\($0)" } ?? "v1/memories",
        method: id == nil ? "POST" : "PATCH", values: ["title": title, "text": text])
      guard current(connection, ticket) else { return false }
      await loadMemories()
      return current(connection, ticket) && memoryError == nil
    } catch {
      guard current(connection, ticket) else { return false }
      memoryError = error.localizedDescription; return false
    }
  }
  func forgetMemory(id: String?) async -> Bool {
    let connection = store.connection, ticket = connectionGeneration
    guard !memoryBusy else { return false }
    memoryGeneration += 1
    memoryBusy = true
    defer { if current(connection, ticket) { memoryBusy = false } }
    do {
      _ = try await client().data(id.map { "v1/memories/\($0)" } ?? "v1/memories", method: "DELETE")
      guard current(connection, ticket) else { return false }
      await loadMemories()
      return current(connection, ticket) && memoryError == nil
    } catch {
      guard current(connection, ticket) else { return false }
      memoryError = error.localizedDescription; return false
    }
  }
  func connectWorkspace(_ provider: String, drafts: Bool = false) async -> URL? {
    let connection = store.connection, ticket = connectionGeneration
    guard !busy, ["gmail", "notion", "instagram", "facebook"].contains(provider) else { return nil }
    busy = true; defer { if current(connection, ticket) { busy = false } }
    do {
      struct Link: Decodable { let url: URL }
      let body = try JSONEncoder().encode(provider == "gmail" && drafts ? ["drafts": true] : [:])
      let bytes = try await client().data("v1/integrations/\(provider)/connect", method: "POST", body: body)
      guard current(connection, ticket) else { return nil }
      let url = try JSONDecoder().decode(Link.self, from: bytes).url
      guard IntegrationSignIn.isAllowed(url, provider: provider) else { throw MochiError.message("Invalid sign-in link.") }
      error = nil; return url
    } catch {
      guard current(connection, ticket) else { return nil }
      self.error = "Connection isn’t available right now. Please try again later."; return nil
    }
  }
  func disconnectWorkspace(_ provider: String) async {
    let connection = store.connection, ticket = connectionGeneration
    guard !busy, ["gmail", "notion", "instagram", "facebook"].contains(provider) else { return }
    busy = true; defer { if current(connection, ticket) { busy = false } }
    do {
      _ = try await client().data("v1/integrations/\(provider)", method: "DELETE")
      guard current(connection, ticket) else { return }
      if provider == "notion" { notionPages = []; notionHasMore = false }
      socialAccounts[provider] = nil
      await refresh()
    } catch {
      guard current(connection, ticket) else { return }
      self.error = "Couldn’t update this connection. Please try again."
    }
  }
  func loadNotionPages(_ query: String) async {
    let connection = store.connection, ticket = connectionGeneration
    guard !busy else { return }
    busy = true; defer { if current(connection, ticket) { busy = false } }
    do {
      // APIClient paths are path components, so the query is sent through a POST search endpoint.
      let bytes = try await client().json("v1/integrations/notion/pages/search", values: ["query": query])
      guard current(connection, ticket) else { return }
      let result = try JSONDecoder().decode(NotionPages.self, from: bytes)
      notionPages = result.pages; notionHasMore = result.hasMore; error = nil
    } catch {
      guard current(connection, ticket) else { return }
      self.error = "Couldn’t update this connection. Please try again."
    }
  }
  func chooseNotionPage(_ id: String) async {
    let connection = store.connection, ticket = connectionGeneration
    guard !busy else { return }
    busy = true; defer { if current(connection, ticket) { busy = false } }
    do {
      _ = try await client().json("v1/integrations/notion/destination", method: "PUT", values: ["id": id])
      guard current(connection, ticket) else { return }
      await refresh()
    } catch {
      guard current(connection, ticket) else { return }
      self.error = "Couldn’t update this connection. Please try again."
    }
  }
  func selectedSocialAccount(_ provider: String) -> SocialAccount? {
    provider == "instagram" ? status?.socialAccounts?.instagram : status?.socialAccounts?.facebook
  }
  func socialConnected(_ provider: String) -> Bool {
    (provider == "instagram" ? status?.instagram : status?.facebook) == "connected"
      && selectedSocialAccount(provider) != nil
  }
  func loadSocialAccounts(_ provider: String, quietly: Bool = false) async {
    let connection = store.connection, ticket = connectionGeneration
    guard !busy, ["instagram", "facebook"].contains(provider) else { return }
    busy = true; defer { if current(connection, ticket) { busy = false } }
    do {
      let result = try await client().get("v1/integrations/\(provider)/accounts", as: AvailableSocialAccounts.self)
      guard current(connection, ticket) else { return }
      socialAccounts[provider] = result.accounts
      error = nil
    } catch {
      guard current(connection, ticket) else { return }
      socialAccounts[provider] = nil
      if !quietly { self.error = "Couldn’t load accounts. Finish signing in, then try refreshing accounts." }
    }
  }
  func chooseSocialAccount(_ provider: String, id: String) async {
    let connection = store.connection, ticket = connectionGeneration
    guard !busy, ["instagram", "facebook"].contains(provider) else { return }
    busy = true; defer { if current(connection, ticket) { busy = false } }
    do {
      _ = try await client().json("v1/integrations/\(provider)/account", method: "PUT", values: ["id": id])
      guard current(connection, ticket) else { return }
      await refresh()
    } catch {
      guard current(connection, ticket) else { return }
      self.error = "Couldn’t select that account. Refresh accounts and try again."
    }
  }
  func connect() async -> URL? {
    let connection = store.connection, ticket = connectionGeneration
    guard !busy else { return nil }
    busy = true
    defer { if current(connection, ticket) { busy = false } }
    do {
      struct Link: Decodable { let url: URL }
      let bytes = try await client().json("v1/integrations/google/connect", values: [:])
      guard current(connection, ticket) else { return nil }
      let url = try JSONDecoder().decode(Link.self, from: bytes).url
      guard IntegrationSignIn.isAllowed(url, provider: "google") else {
        throw MochiError.message("The sign-in link was not valid.")
      }
      error = nil
      return url
    } catch {
      guard current(connection, ticket) else { return nil }
      self.error = "Calendar sign-in isn’t available right now. Please try again later."
      return nil
    }
  }
  func enable(_ enabled: Bool) async {
    let connection = store.connection, ticket = connectionGeneration
    guard !busy else { return }
    busy = true
    defer { if current(connection, ticket) { busy = false } }
    do {
      _ = try await client().data(
        "v1/integrations/google", method: "PATCH", body: JSONEncoder().encode(["enabled": enabled]))
      guard current(connection, ticket) else { return }
      await refresh()
    } catch {
      guard current(connection, ticket) else { return }
      self.error = "Couldn’t update this connection. Please try again."
    }
  }
  func disconnect() async {
    let connection = store.connection, ticket = connectionGeneration
    guard !busy else { return }
    busy = true
    defer { if current(connection, ticket) { busy = false } }
    do {
      _ = try await client().data("v1/integrations/google", method: "DELETE")
      guard current(connection, ticket) else { return }
      await refresh()
    } catch {
      guard current(connection, ticket) else { return }
      self.error = "Couldn’t update this connection. Please try again."
    }
  }
}
