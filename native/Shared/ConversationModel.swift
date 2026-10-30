import Foundation
import CryptoKit
import MochiCore
import Observation

struct Activity: Identifiable {
  let id = UUID()
  let time = Date()
  let kind: String
  let text: String
  var sources: [SearchSource] = []
}
@MainActor @Observable final class ConversationModel {
  var contactLookup: ContactLookup?
  private(set) var contactCandidates: [LocalContact] = []
  private(set) var contactMessage = ""
  private(set) var contactBusy = false
  private let contacts: any ContactSearching
  private var contactTask: Task<Void, Never>?
  private var contactExpiry: Task<Void, Never>?
  private var contactPermissionPrompt = false
  private var contactSubmission: Data?
  var mood: Mood = .sleep
  var caption = "tap on me to wake up"
  var level = 0.0
  var heartStart: Date?
  var transcript = ""
  var reply = ""
  var sources: [SearchSource] = []
  var action: Action?
  var documentAction: DocumentAction?
  var gmailDraftAction: GmailDraftAction?
  let daily: DailySupportModel
  private var callProposal: CallAction?
  private(set) var taskCalls: [CallAction] = []
  var tasksLoadFailed = false
  var backgroundCall: CallAction?
  var callAction: CallAction? {
    get { callProposal ?? backgroundCall }
    set {
      if let call = newValue { receiveCall(call) }
      else { callProposal = nil; backgroundCall = nil }
    }
  }
  var callUpdating = false
  private var callTask: Task<Void, Never>?
  private var callGeneration = UUID()
  private let defaults: UserDefaults
  private var dismissedCalls: Set<String> = []
  var completionCall: CallAction? {
    guard foreground, !recording, !deciding, !callUpdating, !hasProposal,
      [.idle, .sleep, .error].contains(mood), let call = backgroundCall,
      !call.active, !dismissedCalls.contains(call.id) else { return nil }
    return call
  }
  var callStatusText: String? {
    guard let call = backgroundCall else { return nil }
    return call.active ? (call.progress?.text ?? "Working on your booking") : call.resultTitle.capitalized
  }
  private var persistenceKey: String? {
    guard let connection = store.connection else { return nil }
    let scope = connection.baseURL.absoluteString + "|" + connection.token
    return "muse.booking." + SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  private func persistCall(_ call: CallAction) {
    guard let key = persistenceKey else { return }
    defaults.set(call.sessionId, forKey: key + ".session")
    defaults.set(call.id, forKey: key + ".call")
    defaults.set(callConfirmationUnknown, forKey: key + ".confirmationUnknown")
    defaults.set(Array(dismissedCalls), forKey: key + ".dismissed")
    defaults.set(Array(unknownConfirmations), forKey: key + ".unknownCalls")
  }
  func receiveCall(_ call: CallAction, track: Bool = true) {
    if let index = taskCalls.firstIndex(where: { $0.id == call.id }) { taskCalls[index] = call }
    else { taskCalls.append(call) }

    guard track else { return }
    if callAction?.id != call.id { callConfirmationUnknown = unknownConfirmations.contains(call.id) }
    if call.status == "pending", !confirmationUnknown(for: call) {
      callProposal = call
    } else {
      if callProposal?.id == call.id { callProposal = nil }
      backgroundCall = call
    }
    persistCall(call)
  }
  private var unknownConfirmations: Set<String> = []
  func confirmationUnknown(for call: CallAction) -> Bool {
    unknownConfirmations.contains(call.id) || (callAction?.id == call.id && callConfirmationUnknown)
  }
  var callConfirmationUnknown = false
  private var callPoll: Task<Void, Never>?
  var hasProposal: Bool { contactLookup != nil || action != nil || documentAction != nil || gmailDraftAction != nil || callProposal != nil }
  var proposalID: String? { action?.id ?? documentAction?.id ?? gmailDraftAction?.id ?? callProposal?.id }
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
  private var responseStartedAt: TimeInterval?
  private(set) var firstAudioLatencyMs: Int?
  private var captionChanged = Date.distantPast
  private var captionTask: Task<Void, Never>?
  private var foreground = true
  private var cancelledTurn: (session: String, request: String, client: APIClient)?
  private var affection = false
  private var endpointTimer: Task<Void, Never>?
  init(
    store: ConnectionStore, audio: any AudioIO, transcriber: any TranscriptionIO,
    defaults: UserDefaults = .standard,
    contacts: any ContactSearching = UnavailableContacts(),
    makeClient: @escaping (Connection) -> APIClient = { APIClient(connection: $0) }
  ) {
    self.contacts = contacts
    self.daily = DailySupportModel(store: store, makeClient: makeClient)
    self.defaults = defaults
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
  private func log(_ kind: String, _ text: String, sources: [SearchSource] = []) {
    activities.append(Activity(kind: kind, text: text, sources: sources))
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
    guard !hasProposal else {
      show(.approval, "tap to review")
      return
    }
    interrupt()
    sources = []
    let ticket = generation
    task = Task { await listen(ticket) }
  }
  // Shares the voice turn path; useful for accessibility clients and deterministic tests.
  func sendText(_ text: String) {
    guard !deciding, !hasProposal, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return }
    foreground = true
    interrupt()
    sources = []
    let ticket = generation
    transcript = text
    responseStartedAt = ProcessInfo.processInfo.systemUptime
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
    responseStartedAt = ProcessInfo.processInfo.systemUptime
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
      throw MochiError.message("Open Mochi on your iPhone to connect.")
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
      if let start = responseStartedAt {
        firstAudioLatencyMs = Int((ProcessInfo.processInfo.systemUptime - start) * 1000)
        responseStartedAt = nil
        log("latency", "First audio: \(firstAudioLatencyMs!) ms after input finished")
      }
      show(.speak, "speaking…")
    }
  }
  private func complete(_ result: TurnResult, input: String, ticket: UUID) async throws {
    guard generation == ticket, !Task.isCancelled, foreground else { return }
    if let lookup = result.contactLookup { beginContactLookup(lookup, ticket: ticket) }
    reply = result.speechText
    sources = (result.sources ?? []).filter { $0.safeURL != nil }
    log("Mochi", result.speechText, sources: sources)
    action = result.action.flatMap {
      ["pending", "uncertain", "executing"].contains($0.status) ? $0 : nil
    }
    documentAction = result.documentAction.flatMap { ["pending", "uncertain", "executing"].contains($0.status) ? $0 : nil }
    gmailDraftAction = result.gmailDraftAction.flatMap { $0.needsReview ? $0 : nil }
    if let call = result.callAction {
      if callAction?.id != call.id { callConfirmationUnknown = false }
      receiveCall(call)
    }
    monitorCall()
    try await speechTail?.value
    guard generation == ticket, !Task.isCancelled, foreground else { return }
    clips.removeAll()
    speechTail = nil
    audio.deactivate()
    if hasProposal {
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
  private func clearContactLookup() {
    contactTask?.cancel()
    contactExpiry?.cancel()
    contactLookup = nil
    contactPermissionPrompt = false
    contactCandidates = []
    contactSubmission = nil
    contactBusy = false
    contactMessage = ""
  }
  private func beginContactLookup(_ lookup: ContactLookup, ticket: UUID) {
    clearContactLookup()
    guard lookup.expiresAt > Date().timeIntervalSince1970 * 1000,
      let connection = store.connection else { return }
    contactLookup = lookup
    contactMessage = "Search contacts on this device for “\(lookup.query)”. Only the name and number you select will be shared for call review."
    contactExpiry = Task {
      try? await Task.sleep(for: .seconds(min(600, max(0, lookup.expiresAt / 1000 - Date().timeIntervalSince1970))))
      guard !Task.isCancelled, generation == ticket, store.connection == connection, contactLookup?.id == lookup.id else { return }
      interrupt()
      show(.idle, "Contact search expired · ask again")
    }
  }
  private func contactPermissionChanged(_ prompting: Bool, lookupID: String, ticket: UUID, connection: Connection) {
    guard generation == ticket, store.connection == connection, contactLookup?.id == lookupID else { return }
    contactPermissionPrompt = prompting
  }
  func becameInactive() {
    // The OS permission sheet temporarily makes the app inactive. Backgrounding
    // and audio interruptions still call suspend and discard all local candidates.
    if !contactPermissionPrompt { suspend() }
  }
  func searchContacts() {
    guard let lookup = contactLookup, !contactBusy, contactSubmission == nil,
      let connection = store.connection else { return }
    let ticket = generation
    contactBusy = true
    contactTask = Task { [self] in
      let result = await contacts.search(lookup.query) { [weak self] prompting in
        await self?.contactPermissionChanged(prompting, lookupID: lookup.id, ticket: ticket, connection: connection)
      }
      guard !Task.isCancelled, generation == ticket, store.connection == connection,
        contactLookup?.id == lookup.id else { return }
      contactBusy = false
      switch result {
      case .matches(let matches, let limited):
        contactCandidates = matches
        contactMessage = matches.isEmpty ? "No matching phone numbers found\(limited ? " in the contacts shared with Mochi" : "")." : "Choose a person and number.\(limited ? " Only contacts shared with Mochi are shown." : "") Numbers need an explicit +country code; edit the contact in Contacts if needed."
        if matches.isEmpty { submitContact(status: "not_found") }
      case .denied:
        contactMessage = "Contacts access is denied or restricted. You can provide an international phone number instead."
        submitContact(status: "denied")
      case .unavailable:
        contactMessage = "Contacts are unavailable on this device. You can provide an international phone number instead."
        submitContact(status: "unavailable")
      }
    }
  }
  func selectContact(_ candidate: LocalContact) {
    guard contactCandidates.contains(candidate), candidate.internationalNumber != nil else { return }
    submitContact(status: "selected", candidate: candidate)
  }
  func cancelContactLookup() {
    if contactBusy || contactSubmission != nil {
      interrupt()
      show(.idle, "Contact selection closed · ask again")
    } else { submitContact(status: "cancelled") }
  }
  func retryContactSubmission() { submitContact(status: "cancelled") }
  private func submitContact(status: String, candidate: LocalContact? = nil) {
    guard let lookup = contactLookup, !contactBusy, let sessionID,
      let connection = store.connection, lookup.expiresAt > Date().timeIntervalSince1970 * 1000 else { return }
    let ticket = generation
    if contactSubmission == nil {
      var payload: [String: Any] = ["requestId": UUID().uuidString, "status": status]
      if let candidate, let number = candidate.internationalNumber {
        var selected = ["displayName": candidate.displayName, "phoneNumber": number]
        selected["phoneLabel"] = candidate.phoneLabel
        payload["contact"] = selected
      }
      contactSubmission = try? JSONSerialization.data(withJSONObject: payload)
    }
    guard let body = contactSubmission else { return }
    speechTail?.cancel()
    speechTail = nil
    clips.forEach { $0.cancel() }
    clips.removeAll()
    audio.stop()
    contactCandidates = []
    contactBusy = true
    activeRequest = (try? JSONSerialization.jsonObject(with: body) as? [String: Any])?["requestId"] as? String
    activeClient = makeClient(connection)
    contactTask = Task {
      do {
        let client = makeClient(connection)
        let bytes = try await client.data("v1/sessions/\(sessionID)/contact-lookups/\(lookup.id)", method: "POST", body: body)
        guard !Task.isCancelled, generation == ticket, store.connection == connection, contactLookup?.id == lookup.id else { return }
        let result = try JSONDecoder().decode(TurnResult.self, from: bytes)
        activeRequest = nil
        // Do not cancel the task currently applying the continuation.
        contactTask = nil
        clearContactLookup()
        speechTail = nil
        queue(result.speechText, client: client, ticket: ticket)
        try await complete(result, input: "", ticket: ticket)
      } catch {
        guard !Task.isCancelled, generation == ticket, store.connection == connection, contactLookup?.id == lookup.id else { return }
        contactBusy = false
        contactMessage = error.localizedDescription + " Retry sends the same selection request; it cannot approve a call. You can also cancel."
      }
    }
  }
  var contactCanRetry: Bool { contactSubmission != nil && !contactBusy }
  func decide(_ confirm: Bool) {
    guard hasProposal, !deciding, let connection = store.connection else { return }
    let calendarProposal = action
    let documentProposal = documentAction
    let draftProposal = gmailDraftAction
    let path: String
    if let action { path = "v1/sessions/\(action.sessionId)/actions/\(action.id)/decision" }
    else if let documentAction { path = "v1/sessions/\(documentAction.sessionId)/documents/\(documentAction.id)/decision" }
    else if let draft = gmailDraftAction { path = "v1/sessions/\(draft.sessionId)/drafts/\(draft.id)/decision" }
    else { return }
    deciding = true
    task?.cancel()
    audio.stop()
    let ticket = generation
    task = Task {
      defer { deciding = false }
      do {
        let client = makeClient(connection)
        let bytes = try await client.json(
          path,
          values: ["decision": confirm ? "confirm" : "cancel"])
        let result = try JSONDecoder().decode(TurnResult.self, from: bytes)
        guard generation == ticket, store.connection == connection else { return }
        if let proposal = calendarProposal {
          guard action?.id == proposal.id, action?.sessionId == proposal.sessionId else { return }
        } else if let proposal = documentProposal {
          guard documentAction?.id == proposal.id, documentAction?.sessionId == proposal.sessionId else { return }
        }
        if let proposal = draftProposal {
          guard gmailDraftAction?.id == proposal.id, gmailDraftAction?.sessionId == proposal.sessionId else { return }
        }
        speechTail = nil
        queue(result.speechText, client: client, ticket: ticket)
        try await complete(result, input: "", ticket: ticket)
      } catch {
        guard generation == ticket, store.connection == connection else { return }
        if let proposal = calendarProposal {
          struct Envelope: Decodable, Sendable { let action: Action }
          if let current = try? await makeClient(connection).get("v1/sessions/\(proposal.sessionId)/actions/\(proposal.id)", as: Envelope.self) {
            guard generation == ticket, store.connection == connection, action?.id == proposal.id, action?.sessionId == proposal.sessionId else { return }
            action = ["pending", "executing", "uncertain"].contains(current.action.status) ? current.action : nil
          }
        } else if let document = documentProposal {
          struct Envelope: Decodable, Sendable { let action: DocumentAction }
          if let current = try? await makeClient(connection).get("v1/sessions/\(document.sessionId)/documents/\(document.id)", as: Envelope.self) {
            guard generation == ticket, store.connection == connection, documentAction?.id == document.id, documentAction?.sessionId == document.sessionId else { return }
            documentAction = ["pending", "executing", "uncertain"].contains(current.action.status) ? current.action : nil
          }
        }
        if let draft = draftProposal {
          struct Envelope: Decodable, Sendable { let action: GmailDraftAction }
          if let current = try? await makeClient(connection).get("v1/sessions/\(draft.sessionId)/drafts/\(draft.id)", as: Envelope.self), generation == ticket, store.connection == connection {
            gmailDraftAction = current.action.needsReview ? current.action : nil
          }
        }
        guard generation == ticket, store.connection == connection else { return }
        fail(error)
      } // Preserve uncertain writes without automatically retrying them.
    }
  }
  func resumeCalls() {
    foreground = true
    guard let connection = store.connection else { return }
    let scope = callGeneration
    if let key = persistenceKey {
      dismissedCalls = Set(defaults.stringArray(forKey: key + ".dismissed") ?? [])
      unknownConfirmations = Set(defaults.stringArray(forKey: key + ".unknownCalls") ?? [])
      if defaults.bool(forKey: key + ".confirmationUnknown"), let id = defaults.string(forKey: key + ".call") { unknownConfirmations.insert(id) }
      callConfirmationUnknown = defaults.bool(forKey: key + ".confirmationUnknown")
    }
    callPoll?.cancel()
    callPoll = Task { [weak self] in
      guard let self else { return }
      do {
        let current = try await makeClient(connection).get("v1/tasks", as: CallsEnvelope.self)
        guard !Task.isCancelled, scope == callGeneration, store.connection == connection else { return }
        let trackedID = persistenceKey.flatMap { self.defaults.string(forKey: $0 + ".call") }
        taskCalls = current.calls
        if let call = taskCalls.first(where: { $0.id == trackedID }) { receiveCall(call) }
        tasksLoadFailed = false
      } catch { if scope == callGeneration { tasksLoadFailed = true } }
      guard !Task.isCancelled, scope == callGeneration else { return }
      monitorCall()
    }
  }
  private func monitorCall() {
    callPoll?.cancel()
    guard foreground, let connection = store.connection else { return }
    let scope = callGeneration
    callPoll = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(self?.taskCalls.contains(where: { $0.active }) == true ? 3 : 15)) } catch { return }
        guard let self, self.foreground, scope == self.callGeneration,
          self.store.connection == connection else { return }
        do {
          let current = try await self.makeClient(connection).get("v1/tasks", as: CallsEnvelope.self)
          guard !Task.isCancelled, scope == self.callGeneration, self.store.connection == connection else { return }
          self.taskCalls = current.calls
          if let tracked = self.callAction, let update = self.taskCalls.first(where: { $0.id == tracked.id }) {
            self.receiveCall(update)
          }
          self.tasksLoadFailed = false
        } catch {
          guard !Task.isCancelled else { return }
          self.tasksLoadFailed = true
        }
      }
    }
  }
  func callCommand(_ command: String, callID: String? = nil) {
    let target = callID == nil ? callAction : taskCalls.first { $0.id == callID }
    guard let call = target, !callUpdating, let connection = store.connection else { return }
    if command == "confirm" && (call.status != "pending" || confirmationUnknown(for: call)) { return }
    if command == "calendar" && hasProposal { return }
    guard ["confirm", "cancel", "stop", "calendar", "refresh"].contains(command) else { return }
    let tracksCall = callAction?.id == call.id
    callUpdating = true
    let blocksApproval = callProposal != nil || command == "calendar"
    if blocksApproval { deciding = true }
    let scope = callGeneration
    callPoll?.cancel()
    callTask = Task {
      defer {
        if scope == callGeneration {
          callUpdating = false
          if blocksApproval { deciding = false }
          monitorCall()
        }
      }
      let client = makeClient(connection)
      let path = "v1/sessions/\(call.sessionId)/calls/\(call.id)"
      do {
        if command == "refresh" {
          let current = try await client.get(path, as: CallEnvelope.self)
          guard scope == callGeneration, store.connection == connection, taskCalls.contains(where: { $0.id == call.id && $0.sessionId == call.sessionId }) else { return }
          receiveCall(current.callAction, track: tracksCall)
        } else {
          if command == "confirm" {
            unknownConfirmations.insert(call.id)
            if tracksCall { callConfirmationUnknown = true; persistCall(call) }
            else if let key = persistenceKey { defaults.set(Array(unknownConfirmations), forKey: key + ".unknownCalls") }
          }
          let suffix = ["confirm", "cancel"].contains(command) ? "decision" : command
          let bytes = try await client.json(path + "/" + suffix, values: suffix == "decision" ? ["decision": command] : [:])
          let result = try JSONDecoder().decode(TurnResult.self, from: bytes)
          guard scope == callGeneration, store.connection == connection, taskCalls.contains(where: { $0.id == call.id && $0.sessionId == call.sessionId }) else { return }
          if let call = result.callAction { receiveCall(call, track: tracksCall) }
          if let proposal = result.action {
            action = ["pending", "uncertain", "executing"].contains(proposal.status) ? proposal : nil
            dismissCallCompletion()
          }
          log("call", result.speechText)
          if blocksApproval { show(hasProposal ? .approval : .idle, hasProposal ? "tap to review" : "tap to talk") }
        }
        failure = nil
      } catch {
        if let current = try? await client.get(path, as: CallEnvelope.self) {
          guard scope == callGeneration, store.connection == connection, taskCalls.contains(where: { $0.id == call.id && $0.sessionId == call.sessionId }) else { return }
          receiveCall(current.callAction, track: tracksCall)
        }
        guard scope == callGeneration, store.connection == connection, taskCalls.contains(where: { $0.id == call.id && $0.sessionId == call.sessionId }) else { return }
        if callConfirmationUnknown, let call = callProposal { receiveCall(call, track: tracksCall) }
        failure = "Couldn’t verify the call update. Refresh its status; no automatic redial will occur."
        if blocksApproval { show(.idle, "tap to talk") }
      }
    }
  }
  func loadLinkedCalendarAction(_ call: CallAction) {
    guard let id = call.calendarActionId, call.supersededBy == nil, !hasProposal,
      !deciding, let connection = store.connection else { return }
    let scope = callGeneration
    Task {
      do {
        struct Envelope: Decodable, Sendable { let action: Action }
        let result = try await makeClient(connection).get("v1/sessions/\(call.sessionId)/actions/\(id)", as: Envelope.self)
        guard scope == callGeneration, store.connection == connection, !hasProposal,
          result.action.sessionId == call.sessionId, result.action.id == id else { return }
        if ["pending", "uncertain", "executing"].contains(result.action.status) { action = result.action }
      } catch {
        guard scope == callGeneration else { return }
        failure = "Couldn’t refresh the linked Calendar approval. Try again."
      }
    }
  }

  /// Preparing a change creates a reviewable proposal; only the decision endpoint may dial.
  func prepareBookingChange(_ call: CallAction, operation: String, start: Date? = nil, end: Date? = nil) {
    guard call.booked, call.supersededBy == nil, !callUpdating, !hasProposal, let connection = store.connection,
      ["reschedule", "cancel_booking"].contains(operation) else { return }
    struct Change: Encodable {
      let operation: String
      let window: BookingWindow?
    }
    let window: BookingWindow?
    if operation == "reschedule" {
      guard let start, let end, start > Date(), end > start else {
        failure = "Choose a future start and a later end for the allowed booking window."
        return
      }
      window = BookingWindow(start: ISO8601DateFormatter().string(from: start), end: ISO8601DateFormatter().string(from: end))
    } else { window = nil }
    let scope = callGeneration
    callUpdating = true
    callTask = Task {
      defer { if scope == callGeneration { callUpdating = false; monitorCall() } }
      do {
        let bytes = try await makeClient(connection).data(
          "v1/sessions/\(call.sessionId)/calls/\(call.id)/change", method: "POST",
          body: JSONEncoder().encode(Change(operation: operation, window: window)))
        let result = try JSONDecoder().decode(TurnResult.self, from: bytes)
        guard scope == callGeneration, store.connection == connection else { return }
        if let proposal = result.callAction { receiveCall(proposal) }
        failure = nil
        log("call", result.speechText)
        show(.approval, "tap to review")
      } catch {
        guard scope == callGeneration, store.connection == connection else { return }
        failure = error.localizedDescription
      }
    }
  }

  func prepareBookingRetry(_ call: CallAction, start: Date, end: Date) {
    guard !callUpdating, !deciding, !hasProposal, let connection = store.connection,
      call.followUp?.canRetry == true else { return }
    guard start > Date(), end > start else { failure = "Choose a future booking window."; return }
    struct Retry: Encodable { let window: BookingWindow }
    let scope = callGeneration
    let conversationGeneration = generation
    callUpdating = true
    callTask = Task {
      defer { if scope == callGeneration { callUpdating = false; monitorCall() } }
      do {
        let result = try JSONDecoder().decode(TurnResult.self, from: await makeClient(connection).data(
          "v1/sessions/\(call.sessionId)/calls/\(call.id)/retry", method: "POST",
          body: JSONEncoder().encode(Retry(window: BookingWindow(start: ISO8601DateFormatter().string(from: start), end: ISO8601DateFormatter().string(from: end))))))
        guard scope == callGeneration, store.connection == connection else { return }
        let foregroundChanged = conversationGeneration != generation || hasProposal || recording || deciding || ![.idle, .sleep, .error].contains(mood)
        if let proposal = result.callAction { receiveCall(proposal, track: !foregroundChanged) }
        if foregroundChanged {
          log("call", "Your retry proposal is saved in Tasks. Finish your current conversation or review, then open it there.")
        } else {
          failure = nil; log("call", result.speechText); show(.approval, "tap to review")
        }
      } catch {
        guard scope == callGeneration, store.connection == connection else { return }
        failure = error.localizedDescription
      }
    }
  }

  func dismissCallCompletion() {
    guard let call = backgroundCall, !call.active else { return }
    dismissedCalls.insert(call.id)
    persistCall(call)
  }
  func dismissCall() {
    guard !callUpdating, let call = callAction, !call.active, call.status != "pending" || confirmationUnknown(for: call) else { return }
    dismissCallCompletion()
    callProposal = nil
    backgroundCall = nil
  }
  func dismissDocument() {
    guard !deciding else { return }
    documentAction = nil
    show(.idle, "tap to talk")
  }
  func dismissGmailDraft() {
    guard !deciding else { return }
    gmailDraftAction = nil
    show(.idle, "tap to talk")
  }
  func connectionChanged() {
    daily.reset()
    gmailDraftAction = nil
    callGeneration = UUID()
    callTask?.cancel()
    callUpdating = false
    deciding = false
    dismissedCalls = []
    taskCalls = []
    unknownConfirmations = []
    tasksLoadFailed = false
    suspend()
    sessionID = nil
    action = nil
    documentAction = nil
    callAction = nil
    callConfirmationUnknown = false
    reply = ""
    failure = nil
  }
  func suspend() {
    foreground = false
    callPoll?.cancel()
    guard !deciding else {
      audio.stop()
      return
    }
    interrupt()
    audio.deactivate()
    show(.sleep, "tap on me to wake up")
  }
  private func interrupt() {
    clearContactLookup()
    generation = UUID()
    responseStartedAt = nil
    firstAudioLatencyMs = nil
    pcm.removeAll()
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
    responseStartedAt = nil
    pcm.removeAll()
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

private struct CallEnvelope: Decodable, Sendable { let callAction: CallAction }

private struct CallsEnvelope: Decodable, Sendable { let calls: [CallAction] }
