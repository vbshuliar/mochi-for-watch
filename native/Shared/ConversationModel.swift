import Foundation
import MuseCore
import Observation

struct Activity: Identifiable {
  let id = UUID()
  let time = Date()
  let kind: String
  let text: String
}
@MainActor @Observable final class ConversationModel {
  var mood: Mood = .sleep
  var caption = "tap on me to wake up"
  var level = 0.0
  var heartStart: Date?
  var transcript = ""
  var reply = ""
  var action: Action?
  var activities: [Activity] = []
  var failure: String?
  var deciding = false
  var recording = false
  private let store: ConnectionStore
  private let audio: any AudioIO
  private let transcriber: any TranscriptionIO
  private let makeClient: (Connection) -> APIClient
  private var task: Task<Void, Never>?
  private var speechTail: Task<Void, Error>?
  private var clips: [Task<Data, Error>] = []
  private var cancellation: Task<Void, Error>?
  private var sessionID: String?
  private var activeRequest: String?
  private var activeClient: APIClient?
  private var generation = UUID()
  private var detector = EndpointDetector()
  private var pcm = Data()
  private var startTime = 0.0
  private var captionChanged = Date.distantPast
  private var captionTask: Task<Void, Never>?
  private var foreground = true
  private var cancelledTurn: (session: String, request: String, client: APIClient)?
  private var affection = false
  private var endpointTimer: Task<Void, Never>?
  init(
    store: ConnectionStore, audio: any AudioIO, transcriber: any TranscriptionIO,
    makeClient: @escaping (Connection) -> APIClient = { APIClient(connection: $0) }
  ) {
    self.store = store
    self.audio = audio
    self.transcriber = transcriber
    self.makeClient = makeClient
    audio.onInterruption = { [weak self] in self?.suspend() }
    transcriber.onPartial = { [weak self] value in
      guard let self, recording else { return }
      transcript = value
      detector.partial(value, at: Date.timeIntervalSinceReferenceDate)
      log("transcript", value)
    }
  }
  private func log(_ kind: String, _ text: String) {
    activities.append(Activity(kind: kind, text: text))
    if activities.count > 100 { activities.removeFirst() }
  }
  private func show(_ mood: Mood, _ text: String) {
    self.mood = mood
    captionTask?.cancel()
    let delay = max(0, 1 - Date().timeIntervalSince(captionChanged))
    if delay == 0 {
      caption = text
      captionChanged = Date()
    } else {
      captionTask = Task {
        try? await Task.sleep(for: .seconds(delay))
        guard !Task.isCancelled else { return }
        caption = text
        captionChanged = Date()
      }
    }
  }
  func tap() {
    guard !deciding else { return }
    foreground = true
    if recording {
      finishRecording()
      return
    }
    guard store.connection != nil else {
      show(.sleep, "connection not ready")
      return
    }
    // A pending Calendar write belongs to its explicit review sheet.
    guard action == nil else {
      show(.approval, "tap to review")
      return
    }
    interrupt()
    let ticket = generation
    task = Task { await listen(ticket) }
  }
  // Shares the voice turn path; useful for accessibility clients and deterministic tests.
  func sendText(_ text: String) {
    guard !deciding, action == nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return }
    foreground = true
    interrupt()
    let ticket = generation
    transcript = text
    log("you", text)
    show(.think, "thinking…")
    task = Task {
      do { try await submit(text, ticket: ticket) } catch {
        if generation == ticket { fail(error) }
      }
    }
  }
  private func listen(_ ticket: UUID) async {
    guard let connection = store.connection else { return }
    do {
      failure = nil
      transcript = ""
      pcm = Data()
      detector = EndpointDetector()
      show(.listen, "listening…")
      audio.onPCM = { [weak self] data, level in
        guard let self, recording, generation == ticket else { return }
        self.level += (level - self.level) * 0.25
        pcm.append(data)
        transcriber.append(data)
        let now = Date.timeIntervalSinceReferenceDate
        if detector.sample(level, at: now) || now - startTime >= 55 { finishRecording() }
      }
      try await audio.startRecording()
      guard generation == ticket, !Task.isCancelled else {
        audio.stopRecording()
        return
      }
      transcriber.start(client: makeClient(connection))
      recording = true
      startTime = Date.timeIntervalSinceReferenceDate
      endpointTimer = Task {
        while !Task.isCancelled && recording && generation == ticket {
          try? await Task.sleep(for: .milliseconds(100))
          if !detector.hasSpeech && Date.timeIntervalSinceReferenceDate - startTime >= 8 {
            interrupt()
            audio.deactivate()
            show(.idle, "didn’t hear you · tap to try")
            return
          }
          if Date.timeIntervalSinceReferenceDate - startTime >= 55 {
            finishRecording()
            return
          }
        }
      }
    } catch { if generation == ticket { fail(error) } }
  }
  private func finishRecording() {
    guard recording else { return }
    recording = false
    audio.stopRecording()
    endpointTimer?.cancel()
    level = 0
    guard detector.hasSpeech else {
      transcriber.cancel()
      audio.deactivate()
      show(.idle, "didn’t hear you · tap to try")
      return
    }
    let ticket = generation
    let recording = pcm
    show(.think, "thinking…")
    task = Task {
      do {
        let text: String
        do { text = try await transcriber.finish() } catch {
          guard generation == ticket, !Task.isCancelled else { return }
          log("connection", "Live transcript unavailable; uploading the recorded audio.")
          try await submitAudio(recording, ticket: ticket)
          return
        }
        guard generation == ticket, !Task.isCancelled else { return }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
          show(.idle, "didn’t hear you · tap to try")
          return
        }
        transcript = text
        log("you", text)
        try await submit(text, ticket: ticket)
      } catch { if generation == ticket { fail(error) } }
      pcm.removeAll()
    }
  }
  private func prepare() async throws -> APIClient {
    if let cancelledTurn {
      do {
        if let cancellation {
          try await cancellation.value
        } else {
          try await cancelledTurn.client.cancel(
            sessionID: cancelledTurn.session, requestID: cancelledTurn.request)
        }
        self.cancelledTurn = nil
        self.cancellation = nil
      } catch {
        self.cancellation = nil
        throw error
      }
    }
    try Task.checkCancellation()
    guard let connection = store.connection else {
      throw MuseError.message("Open Muse on your iPhone to connect.")
    }
    let client = makeClient(connection)
    activeClient = client
    if sessionID == nil { sessionID = try await client.createSession() }
    return client
  }
  private func submitAudio(_ data: Data, ticket: UUID) async throws {
    let client = try await prepare()
    try Task.checkCancellation()
    let id = UUID().uuidString
    activeRequest = id
    let bytes = try await client.data(
      "v1/sessions/\(sessionID!)/audio", method: "POST", body: WAV.encode(pcm: data),
      contentType: "audio/wav", requestID: id)
    guard generation == ticket else { return }
    activeRequest = nil
    let result = try JSONDecoder().decode(TurnResult.self, from: bytes)
    queue(result.speechText, client: client, ticket: ticket)
    try await complete(result, input: "", ticket: ticket)
  }
  private func submit(_ text: String, ticket: UUID) async throws {
    let normalized = text.lowercased().trimmingCharacters(
      in: .punctuationCharacters.union(.whitespacesAndNewlines))
    if ["stop talking", "stop speaking", "be quiet"].contains(normalized) {
      show(.idle, "tap to talk")
      return
    }
    let client = try await prepare()
    try Task.checkCancellation()
    if ["repeat that", "say that again", "repeat your last reply"].contains(normalized),
      !reply.isEmpty
    {
      queue(reply, client: client, ticket: ticket)
      try await speechTail?.value
      if generation == ticket {
        audio.deactivate()
        show(.idle, "tap to talk")
      }
      return
    }
    affection = Reactions.choose(input: text) == .loved
    if affection {
      heartStart = Date()
      show(.loved, "aww, thank you!")
    }
    let id = UUID().uuidString
    activeRequest = id
    var buffer = SentenceBuffer()
    let collector = SentenceCollector(buffer: buffer)
    let result = try await client.stream(sessionID: sessionID!, requestID: id, text: text) {
      [weak self] cumulative in
      await self?.receive(cumulative, collector: collector, client: client, ticket: ticket)
    }
    guard generation == ticket else { return }
    activeRequest = nil
    buffer = collector.buffer
    if let error = collector.error { throw error }
    for sentence in try buffer.append(result.speechText, final: true) {
      queue(sentence, client: client, ticket: ticket)
    }
    try await complete(result, input: text, ticket: ticket)
  }
  private func receive(
    _ text: String, collector: SentenceCollector, client: APIClient, ticket: UUID
  ) {
    guard generation == ticket, collector.error == nil else { return }
    do {
      for sentence in try collector.buffer.append(text) {
        queue(sentence, client: client, ticket: ticket)
      }
    } catch { collector.error = error }
  }
  private func queue(_ text: String, client: APIClient, ticket: UUID) {
    guard foreground else { return }
    let fetch = Task { try await client.speech(text) }
    clips.append(fetch)
    let previous = speechTail
    speechTail = Task {
      try await previous?.value
      let bytes = try await fetch.value
      try Task.checkCancellation()
      guard generation == ticket, foreground else { throw CancellationError() }
      audio.onPlaybackStart = playbackCallback(ticket)
      try await audio.play(bytes)
    }
  }
  private func playbackCallback(_ ticket: UUID) -> () -> Void {
    { [weak self] in
      guard let self, generation == ticket, foreground else { return }
      show(.speak, "speaking…")
    }
  }
  private func complete(_ result: TurnResult, input: String, ticket: UUID) async throws {
    reply = result.speechText
    log("Jolly", result.speechText)
    action = result.action.flatMap {
      ["pending", "uncertain", "executing"].contains($0.status) ? $0 : nil
    }
    try await speechTail?.value
    guard generation == ticket, !Task.isCancelled, foreground else { return }
    clips.removeAll()
    speechTail = nil
    audio.deactivate()
    if action != nil {
      show(.approval, "tap to review")
      return
    }
    if result.state == "happy" {
      show(.happy, result.statusText)
      try await Task.sleep(for: .seconds(2.4))
    } else if !affection,
      let reaction = Reactions.choose(input: input, reply: reply, state: result.state)
    {
      show(reaction, result.state == "clarify" ? "tap to answer" : "tap to talk")
      try await Task.sleep(for: .seconds(2.4))
    }
    guard generation == ticket else { return }
    affection = false
    show(.idle, reply.hasSuffix("?") ? "tap to answer" : "tap to talk")
  }
  func decide(_ confirm: Bool) {
    guard let action, !deciding, let connection = store.connection else { return }
    deciding = true
    task?.cancel()
    audio.stop()
    let ticket = generation
    task = Task {
      defer { deciding = false }
      do {
        let client = makeClient(connection)
        let bytes = try await client.json(
          "v1/sessions/\(action.sessionId)/actions/\(action.id)/decision",
          values: ["decision": confirm ? "confirm" : "cancel"])
        let result = try JSONDecoder().decode(TurnResult.self, from: bytes)
        speechTail = nil
        queue(result.speechText, client: client, ticket: ticket)
        try await complete(result, input: "", ticket: ticket)
      } catch { fail(error) }  // Keep the proposal for an explicit retry, never invent success.
    }
  }
  func connectionChanged() {
    suspend()
    sessionID = nil
    action = nil
    reply = ""
    failure = nil
  }
  func suspend() {
    foreground = false
    guard !deciding else {
      audio.stop()
      return
    }
    interrupt()
    audio.deactivate()
    show(.sleep, "tap on me to wake up")
  }
  private func interrupt() {
    generation = UUID()
    task?.cancel()
    endpointTimer?.cancel()
    speechTail?.cancel()
    speechTail = nil
    clips.forEach { $0.cancel() }
    clips.removeAll()
    transcriber.cancel()
    audio.stop()
    recording = false
    level = 0
    heartStart = nil
    affection = false
    if let id = activeRequest, let sessionID, let connection = store.connection {
      let client = activeClient ?? makeClient(connection)
      cancelledTurn = (sessionID, id, client)
      cancellation = Task { try await client.cancel(sessionID: sessionID, requestID: id) }
    }
    activeRequest = nil
  }
  private func fail(_ error: Error) {
    guard !(error is CancellationError) else { return }
    if let id = activeRequest, let sessionID, let connection = store.connection {
      let client = activeClient ?? makeClient(connection)
      cancelledTurn = (sessionID, id, client)
      cancellation = Task { try await client.cancel(sessionID: sessionID, requestID: id) }
      activeRequest = nil
    }
    failure = error.localizedDescription
    log("error", error.localizedDescription)
    audio.deactivate()
    speechTail?.cancel()
    clips.forEach { $0.cancel() }
    transcriber.cancel()
    endpointTimer?.cancel()
    recording = false
    level = 0
    affection = false
    heartStart = nil
    if let network = error as? URLError,
      [.notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost].contains(network.code)
    {
      show(.sleep, "offline · tap to try")
    } else {
      show(.error, "couldn’t connect · tap to try")
    }
  }
}
@MainActor private final class SentenceCollector {
  var buffer: SentenceBuffer
  var error: Error?
  init(buffer: SentenceBuffer) { self.buffer = buffer }
}
