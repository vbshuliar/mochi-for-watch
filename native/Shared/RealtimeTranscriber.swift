import Foundation
import MuseCore

@MainActor final class RealtimeTranscriber {
  private var generation = UUID()
  private var socket: URLSessionWebSocketTask?
  private var receiver: Task<Void, Never>?
  private var sender: Task<Void, Never>?
  private var pending: [Data] = []
  private var pendingBytes = 0
  private var ready = false, ending = false
  private var outcome: Result<String, Error>?
  private var waiter: CheckedContinuation<String, Error>?
  var onPartial: ((String) -> Void)?
  func start(client: APIClient) {
    cancel()
    let ticket = generation
    ready = false
    ending = false
    outcome = nil
    var request = client.request("v1/realtime")
    var components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
    components.scheme = components.scheme == "https" ? "wss" : "ws"
    request.url = components.url
    let socket = URLSession.shared.webSocketTask(with: request)
    self.socket = socket
    socket.resume()
    receiver = Task { [weak self] in
      do {
        while !Task.isCancelled {
          let message = try await socket.receive()
          let data: Data
          switch message {
          case .data(let bytes): data = bytes
          case .string(let text): data = Data(text.utf8)
          @unknown default: continue
          }
          struct Event: Decodable {
            let type: String
            let text: String?
          }
          let event = try JSONDecoder().decode(Event.self, from: data)
          guard let self, generation == ticket else { return }
          switch event.type {
          case "ready":
            ready = true
            drain()
          case "partial": onPartial?(event.text ?? "")
          case "final":
            complete(.success(event.text ?? ""))
            return
          case "error": throw MuseError.message("Live transcription is unavailable.")
          default: break
          }
        }
      } catch { if self?.generation == ticket { self?.complete(.failure(error)) } }
    }
  }
  func append(_ pcm: Data) {
    guard !ending, outcome == nil else { return }
    guard pendingBytes + pcm.count <= 256000 else {
      complete(.failure(MuseError.message("Transcription couldn’t keep up.")))
      return
    }
    pending.append(pcm)
    pendingBytes += pcm.count
    drain()
  }
  private func drain() {
    guard ready, sender == nil, let socket, outcome == nil else { return }
    let ticket = generation
    sender = Task { [weak self] in
      guard let self else { return }
      defer { if generation == ticket { sender = nil } }
      do {
        while !pending.isEmpty {
          guard generation == ticket else { return }
          try Task.checkCancellation()
          let chunk = pending.removeFirst()
          pendingBytes -= chunk.count
          try await socket.send(.data(chunk))
        }
        if generation == ticket && ending { try await socket.send(.string("{\"type\":\"end\"}")) }
      } catch { if generation == ticket { complete(.failure(error)) } }
    }
  }
  func finish() async throws -> String {
    ending = true
    drain()
    let ticket = generation
    let timeout = Task { [weak self] in
      try? await Task.sleep(for: .seconds(12))
      if !Task.isCancelled && self?.generation == ticket {
        self?.complete(.failure(MuseError.message("Transcription timed out.")))
      }
    }
    defer { timeout.cancel() }
    if let outcome { return try outcome.get() }
    return try await withCheckedThrowingContinuation { waiter = $0 }
  }
  private func complete(_ result: Result<String, Error>) {
    guard outcome == nil else { return }
    outcome = result
    waiter?.resume(with: result)
    waiter = nil
    socket?.cancel(with: .normalClosure, reason: nil)
    sender?.cancel()
    pending.removeAll()
    pendingBytes = 0
  }
  func cancel() {
    generation = UUID()
    complete(.failure(CancellationError()))
    receiver?.cancel()
    sender?.cancel()
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    receiver = nil
    sender = nil
    pending.removeAll()
    pendingBytes = 0
  }
}
