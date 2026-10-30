import MochiCore
import XCTest

#if canImport(MochiPhone)
  @testable import MochiPhone
#else
  @testable import MochiConversation
#endif

@MainActor private final class FakeAudio: AudioIO {
  var onPCM: ((Data, Double) -> Void)?
  var onPlaybackStart: (() -> Void)?
  var onInterruption: (() -> Void)?
  var played = 0, recording = false
  var denyMicrophone = false
  var finish: CheckedContinuation<Void, Error>?
  func startRecording() async throws {
    if denyMicrophone { throw MochiError.message("Microphone permission denied.") }
    recording = true
  }
  func stopRecording() { recording = false }
  func play(_ data: Data) async throws {
    played += 1
    onPlaybackStart?()
    try await withCheckedThrowingContinuation { finish = $0 }
  }
  func complete() {
    finish?.resume()
    finish = nil
  }
  func stop() {
    recording = false
    finish?.resume(throwing: CancellationError())
    finish = nil
  }
  func deactivate() { stop() }
}
@MainActor private final class FakeTranscript: TranscriptionIO {
  var onPartial: ((String) -> Void)?
  func start(client: APIClient) {}
  func append(_ pcm: Data) {}
  func finish() async throws -> String { "hello" }
  func cancel() {}
}
private final class NativeFixture: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let path = request.url!.path
    let body: String
    var responseStatus = 200
    if path.hasSuffix("/sessions") {
      body = #"{"id":"test-session"}"#
    } else if path.contains("/actions/") {
      if path.hasSuffix("/stale/decision") {
        body = #"{"sessionId":"test-session","state":"approval","statusText":"Review event","speechText":"Private old conversation","simulated":true,"action":\#(calendarFixture(id: "stale", status: "pending"))}"#
      } else if path.hasSuffix("/decision") {
        responseStatus = 409
        body = #"{"error":{"message":"Calendar decision could not be completed."}}"#
      } else if path.hasSuffix("/unavailable") {
        responseStatus = 503
        body = #"{"error":{"message":"Temporarily unavailable."}}"#
      } else {
        let status = request.url!.lastPathComponent
        body = "{\"action\":" + calendarFixture(id: status, status: status) + "}"
      }
    } else if path.hasSuffix("/tasks") {
      body = "{\"calls\":[" + callFixture + "," + callFixture.replacingOccurrences(of: "call-1", with: "call-2").replacingOccurrences(of: "test-session", with: "foreign-session") + "]}"
    } else if path.hasSuffix("/retry") {
      XCTAssertTrue(path.contains("/sessions/foreign-session/"))
      let changed = callFixture.replacingOccurrences(of: "call-1", with: "retry-proposal").replacingOccurrences(of: "uncertain", with: "pending").replacingOccurrences(of: "test-session", with: "foreign-session")
      body = #"{"sessionId":"foreign-session","state":"approval","statusText":"Review retry","speechText":"Review this call before calling again.","simulated":true,"callAction":\#(changed)}"#
    } else if path.hasSuffix("/change") {
      let changed = callFixture.replacingOccurrences(of: "call-1", with: "change-proposal").replacingOccurrences(of: "uncertain", with: "pending")
      body = #"{"sessionId":"test-session","state":"approval","statusText":"Review cancellation call","speechText":"Review this call before Mochi cancels the booking.","simulated":true,"callAction":\#(changed)}"#
    } else if path.hasSuffix("/stop") {
      body = #"{"sessionId":"test-session","state":"idle","statusText":"Stopped","speechText":"Call stopped.","simulated":true,"callAction":\#(callFixture.replacingOccurrences(of: "uncertain", with: "cancelled"))}"#
    } else if path.contains("/calls/") {
      body = "{\"callAction\":" + callFixture + "}"
    } else if path.contains("/sessions/foreign-session/stream") {
      responseStatus = 409
      body = #"{"error":{"message":"A task must not replace the conversation session."}}"#
    } else if path.hasSuffix("/stream") {
      body =
        #"{"type":"text","text":"That’s so sweet! "}"# + "\n"
        + #"{"type":"result","result":{"sessionId":"test-session","state":"speak","statusText":"speaking…","speechText":"That’s so sweet! ","simulated":true}}"#
        + "\n"
    } else if path.hasSuffix("/cancel") {
      body = #"{"cancelled":true}"#
    } else {
      body = "fake MP3; FakeAudio deliberately accepts fixture bytes"
    }
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(
        url: request.url!, statusCode: responseStatus, httpVersion: "HTTP/1.1", headerFields: nil)!,
      cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
@MainActor final class NativeConversationTests: XCTestCase {
  private func makeModel(defaults: UserDefaults? = nil, token: String = String(repeating: "t", count: 32)) throws -> (ConversationModel, FakeAudio) {
    let connection = try Connection(
      baseURL: URL(string: "https://native.fixture")!, token: token)
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [NativeFixture.self]
    let session = URLSession(configuration: config)
    let audio = FakeAudio()
    let model = ConversationModel(
      store: ConnectionStore(connection: connection), audio: audio, transcriber: FakeTranscript(),
      defaults: defaults ?? UserDefaults(suiteName: "native-tests-" + UUID().uuidString)!,
      makeClient: { APIClient(connection: $0, session: session) })
    return (model, audio)
  }
  private func eventually(_ predicate: () -> Bool) async {
    for _ in 0..<100 {
      if predicate() { return }
      try? await Task.sleep(for: .milliseconds(20))
    }
    XCTFail("Timed out waiting for native conversation state")
  }
  func testHeartsStartBeforeSpeechAndIdleWaitsForPlayback() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    model.sendText("Hey Mochi, I really love you!")
    await eventually { audio.played == 1 }
    XCTAssertNotNil(model.heartStart)
    XCTAssertEqual(model.mood, .speak)
    XCTAssertEqual(model.reply, "That’s so sweet! ")
    audio.complete()
    await eventually { model.mood == .idle }
    XCTAssertNotNil(
      model.heartStart, "The clock stays stable so finishing speech cannot restart the burst")
  }
  func testTapInterruptsPlaybackAndBeginsListening() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    model.sendText("hello")
    await eventually { audio.played == 1 }
    model.tap()
    await eventually { model.recording }
    XCTAssertEqual(model.mood, .listen)
    XCTAssertNil(audio.finish)
    XCTAssertTrue(audio.recording)
  }
  func testPermissionDenialLeavesATappableErrorWithoutRecording() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    audio.denyMicrophone = true
    model.tap()
    await eventually { model.failure != nil }
    XCTAssertFalse(model.recording)
    XCTAssertFalse(audio.recording)
    XCTAssertEqual(model.mood, .error)
    XCTAssertEqual(model.failure, "Microphone permission denied.")
  }
  func testConnectionChangeClearsOldSessionPresentationAndStopsVoice() async throws {
    let (model, audio) = try makeModel()
    model.sendText("hello")
    await eventually { audio.played == 1 }
    model.connectionChanged()
    XCTAssertEqual(model.reply, "")
    XCTAssertNil(model.action)
    XCTAssertNil(audio.finish)
    XCTAssertEqual(model.mood, .sleep)
  }
  func testBackgroundingStopsVoiceAndClearsHearts() async throws {
    let (model, audio) = try makeModel()
    model.sendText("I love you")
    await eventually { audio.played == 1 }
    model.suspend()
    XCTAssertEqual(model.mood, .sleep)
    XCTAssertNil(model.heartStart)
    XCTAssertNil(audio.finish)
    try await Task.sleep(for: .milliseconds(50))
    XCTAssertEqual(model.mood, .sleep)
  }
}

private let callFixture = #"{"id":"call-1","sessionId":"test-session","status":"uncertain","expiresAt":9999999999999,"calendarChecked":false,"slots":[],"booking":{"destinationName":"Salon","phoneNumber":"+442012345678","purpose":"Haircut","customerName":"Alex","timeZone":"Europe/London","window":{"start":"2026-11-01T10:00:00Z","end":"2026-11-01T12:00:00Z"},"durationMinutes":30}}"#

extension NativeConversationTests {
  func testFailedCallConfirmationRefreshesAndCannotRedial() async throws {
    let (model, _) = try makeModel()
    model.callAction = try JSONDecoder().decode(CallAction.self, from: Data(callFixture.replacingOccurrences(of: "uncertain", with: "pending").utf8))
    model.callCommand("confirm")
    await eventually { !model.deciding }
    XCTAssertEqual(model.callAction?.status, "uncertain")
    XCTAssertTrue(model.callConfirmationUnknown)
    model.callCommand("confirm")
    XCTAssertFalse(model.deciding)
    model.dismissCall()
    XCTAssertNil(model.callAction)
    XCTAssertFalse(model.hasProposal)
  }
}


extension NativeConversationTests {
  func testCallBookingDecodesFlexibleAndLegacyWindows() throws {
    let legacy = try JSONDecoder().decode(CallAction.self, from: Data(callFixture.utf8))
    XCTAssertEqual(legacy.booking.allowedWindows.count, 1)
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(callFixture.utf8)) as? [String: Any])
    var booking = try XCTUnwrap(object["booking"] as? [String: Any])
    booking["windows"] = [
      ["start": "2026-11-02T14:00:00Z", "end": "2026-11-02T16:00:00Z"],
      ["start": "2026-11-04T14:00:00Z", "end": "2026-11-04T16:00:00Z"],
    ]
    object["booking"] = booking
    let flexible = try JSONDecoder().decode(CallAction.self, from: JSONSerialization.data(withJSONObject: object))
    XCTAssertEqual(flexible.booking.allowedWindows.count, 2)
    XCTAssertEqual(flexible.booking.allowedWindows[1].start, "2026-11-04T14:00:00Z")
  }
}


private func calendarFixture(id: String, status: String) -> String {
  #"{"id":"\#(id)","sessionId":"test-session","status":"\#(status)","expiresAt":1,"event":{"title":"Lunch","start":"2026-11-01T12:00:00Z","end":"2026-11-01T13:00:00Z","timeZone":"Europe/London"}}"#
}

extension NativeConversationTests {
  func testFailedCalendarDecisionClearsAuthoritativeTerminalProposal() async throws {
    for status in ["expired", "cancelled", "executed"] {
      let (model, audio) = try makeModel()
      defer { model.suspend() }
      model.action = try JSONDecoder().decode(Action.self, from: Data(calendarFixture(id: status, status: "pending").utf8))
      model.decide(true)
      await eventually { !model.deciding }
      XCTAssertNil(model.action, status)
      XCTAssertFalse(model.hasProposal, status)
      model.tap()
      await eventually { model.recording }
      XCTAssertTrue(audio.recording, status)
    }
  }

  func testFailedCalendarDecisionPreservesRecoverableProposal() async throws {
    for status in ["pending", "uncertain", "executing", "unavailable"] {
      let (model, _) = try makeModel()
      defer { model.suspend() }
      model.action = try JSONDecoder().decode(Action.self, from: Data(calendarFixture(id: status, status: "pending").utf8))
      model.decide(true)
      await eventually { !model.deciding }
      XCTAssertEqual(model.action?.status, status == "unavailable" ? "pending" : status)
      XCTAssertTrue(model.hasProposal)
      XCTAssertNotNil(model.failure)
    }
  }
}


extension NativeConversationTests {
  func testCalendarDecisionResponseAfterConnectionResetCannotRestoreOldConversation() async throws {
    let (model, audio) = try makeModel()
    model.action = try JSONDecoder().decode(Action.self, from: Data(calendarFixture(id: "stale", status: "pending").utf8))
    model.decide(true)
    XCTAssertTrue(model.deciding)
    model.connectionChanged()
    await eventually { !model.deciding }
    XCTAssertNil(model.action)
    XCTAssertFalse(model.hasProposal)
    XCTAssertEqual(model.reply, "")
    XCTAssertTrue(model.sources.isEmpty)
    XCTAssertEqual(audio.played, 0)
  }
}


extension NativeConversationTests {
  private func call(_ status: String, booked: Bool = false, id: String = "call-1", finishedAt: Double? = nil) throws -> CallAction {
    var data = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(callFixture.utf8)) as? [String: Any])
    data["status"] = status
    data["id"] = id
    data["finishedAt"] = finishedAt
    if booked {
      data["outcome"] = "booked"
      data["bookedSlot"] = ["start": "2026-11-01T10:00:00Z", "end": "2026-11-01T10:30:00Z"]
    }
    return try JSONDecoder().decode(CallAction.self, from: JSONSerialization.data(withJSONObject: data))
  }
  func testActiveBookingAllowsVoiceAndUnrelatedReplyPreservesTask() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    model.receiveCall(try call("in_progress"))
    XCTAssertFalse(model.hasProposal)
    model.tap()
    await eventually { model.recording }
    model.sendText("hello")
    await eventually { audio.played == 1 }
    XCTAssertEqual(model.backgroundCall?.id, "call-1")
    XCTAssertEqual(model.backgroundCall?.status, "in_progress")
    XCTAssertFalse(model.hasProposal)
  }
  func testCompletionWaitsForSpeechThenDismissalSurvivesRefresh() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    model.receiveCall(try call("in_progress"))
    model.sendText("hello")
    await eventually { audio.played == 1 }
    model.receiveCall(try call("completed", booked: true))
    XCTAssertNil(model.completionCall)
    XCTAssertEqual(model.mood, .speak)
    audio.complete()
    await eventually { model.mood == .idle }
    XCTAssertEqual(model.completionCall?.id, "call-1")
    model.dismissCallCompletion()
    model.receiveCall(try call("completed", booked: true))
    XCTAssertNil(model.completionCall)
    model.tap()
    await eventually { model.recording }
  }
  func testCompletionWaitsForRecordingAndForegroundApproval() async throws {
    let (model, _) = try makeModel()
    defer { model.suspend() }
    model.tap()
    await eventually { model.recording }
    model.receiveCall(try call("completed", booked: true))
    XCTAssertNil(model.completionCall)
    model.suspend()
    model.mood = .idle
    model.action = try JSONDecoder().decode(Action.self, from: Data(calendarFixture(id: "pending", status: "pending").utf8))
    model.resumeCalls()
    XCTAssertNil(model.completionCall)
  }
  func testResumeRestoresOnlyTrackedConnectionTaskAndDismissal() async throws {
    let defaults = UserDefaults(suiteName: "native-restore-" + UUID().uuidString)!
    let (original, _) = try makeModel(defaults: defaults)
    original.receiveCall(try call("uncertain"))
    original.dismissCallCompletion()
    original.suspend()
    let (restored, _) = try makeModel(defaults: defaults)
    defer { restored.suspend() }
    restored.resumeCalls()
    await eventually { restored.backgroundCall?.id == "call-1" }
    restored.mood = .idle
    XCTAssertNil(restored.completionCall)
    XCTAssertFalse(restored.hasProposal)
    let (other, _) = try makeModel(defaults: defaults, token: String(repeating: "x", count: 32))
    other.resumeCalls()
    try await Task.sleep(for: .milliseconds(50))
    XCTAssertNil(other.callAction)
  }
  func testStopRemainsAvailableDuringConversation() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    model.receiveCall(try call("in_progress"))
    model.sendText("hello")
    await eventually { audio.played == 1 }
    model.action = try JSONDecoder().decode(Action.self, from: Data(calendarFixture(id: "pending", status: "pending").utf8))
    model.callCommand("stop")
    XCTAssertFalse(model.deciding)
    await eventually { !model.callUpdating }
    XCTAssertEqual(model.backgroundCall?.status, "cancelled")
    XCTAssertEqual(model.mood, .speak)
    XCTAssertNotNil(audio.finish)
    XCTAssertNil(model.completionCall)
  }
  func testLateCallResponseCannotRestoreClearedConnection() async throws {
    let (model, _) = try makeModel()
    model.receiveCall(try call("in_progress"))
    model.callCommand("refresh")
    model.connectionChanged()
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertNil(model.callAction)
    XCTAssertFalse(model.callUpdating)
  }
}


extension NativeConversationTests {
  func testPendingApprovalStillBlocksChatAndThinkingDefersCompletion() async throws {
    let (model, audio) = try makeModel()
    model.receiveCall(try call("pending"))
    XCTAssertTrue(model.hasProposal)
    model.sendText("hello")
    model.tap()
    try await Task.sleep(for: .milliseconds(30))
    XCTAssertFalse(model.recording)
    XCTAssertEqual(audio.played, 0)
    model.receiveCall(try call("completed", booked: true))
    model.mood = .think
    XCTAssertNil(model.completionCall)
    model.mood = .idle
    XCTAssertTrue(model.completionCall?.booked == true)
    model.suspend()
  }
}


extension NativeConversationTests {
  func testBookingCalendarCannotReplaceForegroundProposal() throws {
    let (model, _) = try makeModel()
    model.receiveCall(try call("completed", booked: true))
    let existing = try JSONDecoder().decode(Action.self, from: Data(calendarFixture(id: "existing", status: "pending").utf8))
    model.action = existing
    model.callCommand("calendar")
    XCTAssertFalse(model.callUpdating, "No Calendar request may start while another proposal needs review")
    XCTAssertEqual(model.action?.id, "existing")
    XCTAssertEqual(model.backgroundCall?.id, "call-1")
    model.suspend()
  }
}


extension NativeConversationTests {
  func testCompletionDateUsesViewerTimezoneAndTwelveHourClock() throws {
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(callFixture.utf8)) as? [String: Any])
    object["status"] = "completed"
    object["outcome"] = "booked"
    object["bookedSlot"] = ["start": "2026-11-06T23:30:00.000Z", "end": "2026-11-07T00:00:00Z"]
    let booking = try JSONDecoder().decode(CallAction.self, from: JSONSerialization.data(withJSONObject: object))
    XCTAssertEqual(booking.completionDateText(timeZone: try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))), "Fri, 6 Nov · 3:30 pm")
    XCTAssertEqual(booking.completionDateText(timeZone: try XCTUnwrap(TimeZone(identifier: "Asia/Tokyo"))), "Sat, 7 Nov · 8:30 am")
    XCTAssertEqual(booking.completionDateText(timeZone: try XCTUnwrap(TimeZone(secondsFromGMT: 3600))), "Sat, 7 Nov · 12:30 am")
    XCTAssertEqual(booking.completionDateText(), booking.completionDateText(timeZone: .autoupdatingCurrent))
  }
}


extension NativeConversationTests {
  func testTaskUpdatesRetainMultipleCallsAndForegroundApproval() throws {
    let (model, _) = try makeModel()
    model.receiveCall(try call("pending", id: "approval"))
    model.receiveCall(try call("in_progress", id: "active"))
    model.receiveCall(try call("completed", id: "older", finishedAt: Date().timeIntervalSince1970 * 1000))
    XCTAssertEqual(Set(model.taskCalls.map(\.id)), ["approval", "active", "older"])
    XCTAssertEqual(model.proposalID, "approval")
    XCTAssertEqual(model.taskCalls.filter { $0.active }.map(\.id), ["active"])
  }

  func testRecentTasksUseCompletionTimeNotFutureBookingTime() throws {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    XCTAssertTrue(try call("completed", booked: true, finishedAt: now.timeIntervalSince1970 * 1000).recentlyCompleted(now: now))
    XCTAssertFalse(try call("completed", booked: true, finishedAt: (now.timeIntervalSince1970 - 86401) * 1000).recentlyCompleted(now: now))
    XCTAssertFalse(try call("completed", booked: true).recentlyCompleted(now: now))
    XCTAssertFalse(try call("uncertain", finishedAt: now.timeIntervalSince1970 * 1000).recentlyCompleted(now: now))
    XCTAssertTrue(try call("uncertain").needsAttention)
    XCTAssertTrue(try call("pending").needsAttention)
    XCTAssertEqual(try call("completed", finishedAt: 0).taskTimeText(timeZone: TimeZone(secondsFromGMT: 3600)!), "1:00 am")
  }

  func testOlderTaskCommandDoesNotReplaceLatestOrInterruptRecording() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    model.receiveCall(try call("in_progress"))
    model.receiveCall(try call("in_progress", id: "newer"))
    model.tap()
    await eventually { model.recording }
    model.callCommand("stop", callID: "call-1")
    await eventually { !model.callUpdating }
    XCTAssertEqual(model.taskCalls.first { $0.id == "call-1" }?.status, "cancelled")
    XCTAssertEqual(model.backgroundCall?.id, "newer")
    XCTAssertTrue(audio.recording)
    model.callCommand("stop", callID: "missing")
    XCTAssertFalse(model.callUpdating)
    model.connectionChanged()
    XCTAssertTrue(model.taskCalls.isEmpty)
  }
}

extension NativeConversationTests {
  func testSessionListRestoresMultipleTasksWithoutSpeaking() async throws {
    let defaults = UserDefaults(suiteName: "task-list-" + UUID().uuidString)!
    let (original, _) = try makeModel(defaults: defaults)
    original.receiveCall(try call("uncertain"))
    original.suspend()
    let (restored, audio) = try makeModel(defaults: defaults)
    defer { restored.suspend() }
    restored.resumeCalls()
    await eventually { restored.taskCalls.count == 2 }
    XCTAssertEqual(Set(restored.taskCalls.map(\.id)), ["call-1", "call-2"])
    XCTAssertEqual(audio.played, 0)
    let (other, _) = try makeModel(defaults: defaults, token: String(repeating: "x", count: 32))
    other.resumeCalls()
    XCTAssertTrue(other.taskCalls.isEmpty)
    other.suspend()
  }
}


extension NativeConversationTests {
  func testLateRetryDoesNotReplaceInterveningCalendarReview() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    var object = try JSONSerialization.jsonObject(with: Data(callFixture.utf8)) as! [String: Any]
    object["sessionId"] = "foreign-session"; object["status"] = "failed"
    object["followUp"] = ["canRetry": true, "canChange": false, "canAddReminder": true, "needsVerification": false, "message": "Choose a new time"]
    let failed = try JSONDecoder().decode(CallAction.self, from: JSONSerialization.data(withJSONObject: object))
    model.prepareBookingRetry(failed, start: Date().addingTimeInterval(86400), end: Date().addingTimeInterval(90000))
    model.action = try JSONDecoder().decode(Action.self, from: Data(calendarFixture(id: "intervening", status: "pending").utf8))
    await eventually { model.taskCalls.contains(where: { $0.id == "retry-proposal" }) }
    XCTAssertEqual(model.action?.id, "intervening")
    XCTAssertNil(model.callAction)
    XCTAssertTrue(model.activities.contains(where: { $0.text.contains("saved in Tasks") }))
    XCTAssertEqual(audio.played, 0)
  }
  func testRetryUsesSourceSessionAndOnlyPreparesApproval() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    var object = try JSONSerialization.jsonObject(with: Data(callFixture.utf8)) as! [String: Any]
    object["sessionId"] = "foreign-session"
    object["status"] = "failed"
    object["followUp"] = ["canRetry": true, "canChange": false, "canAddReminder": true, "needsVerification": false, "message": "Choose a new time"]
    let failed = try JSONDecoder().decode(CallAction.self, from: JSONSerialization.data(withJSONObject: object))
    model.prepareBookingRetry(failed, start: Date().addingTimeInterval(86400), end: Date().addingTimeInterval(90000))
    await eventually { model.callAction?.id == "retry-proposal" }
    XCTAssertEqual(model.callAction?.status, "pending")
    XCTAssertEqual(model.callAction?.sessionId, "foreign-session")
    XCTAssertEqual(audio.played, 0)
  }
  func testFreshDeviceLoadsTasksFromOtherSessionsWithoutStartingConversation() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    model.resumeCalls()
    await eventually { model.taskCalls.count == 2 }
    XCTAssertEqual(Set(model.taskCalls.map(\.sessionId)), ["test-session", "foreign-session"])
    XCTAssertNil(model.callAction, "Task discovery must not force a foreground approval")
    XCTAssertEqual(audio.played, 0)
    XCTAssertFalse(model.tasksLoadFailed)
  }
  func testForeignTaskDoesNotAdoptItsConversationSession() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    let foreign = callFixture.replacingOccurrences(of: "test-session", with: "foreign-session")
    model.receiveCall(try JSONDecoder().decode(CallAction.self, from: Data(foreign.utf8)))
    model.sendText("hello")
    await eventually { audio.played == 1 }
    XCTAssertNil(model.failure)
    XCTAssertEqual(model.backgroundCall?.sessionId, "foreign-session")
  }
  func testAudioInterruptionStopsRecordingAndLatePartialCannotReviveIt() async throws {
    let (model, audio) = try makeModel()
    model.tap()
    await eventually { model.recording }
    audio.onInterruption?()
    XCTAssertFalse(model.recording)
    XCTAssertFalse(audio.recording)
    XCTAssertEqual(model.mood, .sleep)
    audio.onPCM?(Data(repeating: 0, count: 4800), 1)
    try await Task.sleep(for: .milliseconds(30))
    XCTAssertEqual(model.mood, .sleep)
    XCTAssertEqual(audio.played, 0)
  }
  func testFirstAudioLatencyIsMeasuredOnceAndClearsOnInterruption() async throws {
    let (model, audio) = try makeModel()
    model.sendText("hello")
    await eventually { audio.played == 1 }
    XCTAssertNotNil(model.firstAudioLatencyMs)
    XCTAssertEqual(model.activities.filter { $0.kind == "latency" }.count, 1)
    audio.onPlaybackStart?()
    XCTAssertEqual(model.activities.filter { $0.kind == "latency" }.count, 1)
    model.suspend()
    XCTAssertNil(model.firstAudioLatencyMs)
  }
  func testChangedBookingOutcomeIsNotMislabelled() throws {
    let data = callFixture.replacingOccurrences(of: "\"uncertain\"", with: "\"completed\",\"outcome\":\"booking_cancelled\",\"operation\":\"cancel_booking\"")
    let cancelled = try JSONDecoder().decode(CallAction.self, from: Data(data.utf8))
    XCTAssertTrue(cancelled.bookingCancelled)
    XCTAssertFalse(cancelled.booked)
    XCTAssertEqual(cancelled.resultTitle, "booking cancelled")
    let moved = try JSONDecoder().decode(CallAction.self, from: Data(data.replacingOccurrences(of: "booking_cancelled", with: "rescheduled").utf8))
    XCTAssertTrue(moved.booked)
    XCTAssertEqual(moved.resultTitle, "booking rescheduled")
  }
}


extension NativeConversationTests {
  func testRegistrationQueueOrdersRemovalBeforeReconnectRegistration() async {
    let queue = SerialRegistrationQueue()
    var events: [String] = []
    var release: CheckedContinuation<Void, Never>?
    queue.enqueue {
      events.append("register A started")
      await withCheckedContinuation { release = $0 }
      events.append("register A finished")
    }
    await eventually { release != nil }
    queue.enqueue { events.append("remove A") }
    queue.enqueue { events.append("remove B") }
    let newest = queue.enqueue { events.append("register A again") }
    XCTAssertEqual(events, ["register A started"])
    release?.resume()
    await newest.value
    XCTAssertEqual(events, ["register A started", "register A finished", "remove A", "remove B", "register A again"])
  }
}


extension NativeConversationTests {
  func testPreparingBookingChangeOnlyCreatesReviewProposal() async throws {
    let (model, audio) = try makeModel()
    defer { model.suspend() }
    let booked = try call("completed", booked: true)
    model.receiveCall(booked)
    model.prepareBookingChange(booked, operation: "cancel_booking")
    await eventually { !model.callUpdating }
    XCTAssertEqual(model.proposalID, "change-proposal")
    XCTAssertEqual(model.callAction?.status, "pending")
    XCTAssertTrue(model.taskCalls.first { $0.id == booked.id }?.booked == true)
    XCTAssertEqual(audio.played, 0)
  }
  func testPreparingRescheduleRejectsInvalidWindowWithoutRequest() throws {
    let (model, _) = try makeModel()
    let booked = try call("completed", booked: true)
    model.prepareBookingChange(booked, operation: "reschedule", start: Date().addingTimeInterval(-60), end: Date())
    XCTAssertNotNil(model.failure)
    XCTAssertFalse(model.callUpdating)
    XCTAssertNil(model.proposalID)
  }
  func testTaskReviewLoadsLinkedCalendarApprovalOnAnotherDevice() async throws {
    let (model, _) = try makeModel()
    defer { model.suspend() }
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(callFixture.utf8)) as? [String: Any])
    object["calendarActionId"] = "pending"
    let linked = try JSONDecoder().decode(CallAction.self, from: JSONSerialization.data(withJSONObject: object))
    model.loadLinkedCalendarAction(linked)
    await eventually { model.action?.id == "pending" }
    XCTAssertEqual(model.action?.sessionId, linked.sessionId)
  }
}

@MainActor final class DailySupportTests: XCTestCase {
  func testBusyProfileLoadDoesNotReportSuccessOrReplaceExistingData() async {
    let model = DailySupportModel(store: ConnectionStore(connection: nil))
    model.busy = true
    var profile = BookingProfile(); profile.destinationName = "Saved salon"
    model.profile = profile
    let loaded = await model.loadProfile()
    XCTAssertFalse(loaded)
    XCTAssertEqual(model.profile?.destinationName, "Saved salon")
  }
  func testDismissedPairingCannotSaveLateConnection() async throws {
    let original = try Connection(baseURL: URL(string: "https://original.fixture")!, token: String(repeating: "o", count: 32))
    let replacement = try Connection(baseURL: URL(string: "https://replacement.fixture")!, token: String(repeating: "r", count: 32))
    let store = ConnectionStore(connection: original)
    var continuation: CheckedContinuation<Connection, Error>?
    let model = PairingModel(store: store, redeem: { _, _ in try await withCheckedThrowingContinuation { continuation = $0 } })
    let request = Task { await model.pair(address: "https://replacement.fixture", code: "ABCDEFGHJKLM2389") }
    for _ in 0..<100 { if continuation != nil { break }; try? await Task.sleep(for: .milliseconds(5)) }
    XCTAssertNotNil(continuation)
    model.cancel()
    continuation?.resume(returning: replacement)
    let result = await request.value
    XCTAssertFalse(result)
    XCTAssertEqual(store.connection, original)
    XCTAssertFalse(model.busy)
  }
  func testBookingProfileEncodesOnlyEditableFieldsAndDisconnectedSaveFails() async throws {
    var profile = BookingProfile()
    profile.destinationName = "Salon"; profile.phoneNumber = "+442012345678"; profile.customerName = "Alex"
    let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(profile)) as! [String: Any]
    XCTAssertEqual(object["preferredDays"] as? [Int], [1,2,3,4,5])
    XCTAssertNil(object["updatedAt"])
    let model = DailySupportModel(store: ConnectionStore(connection: nil))
    let saved = await model.saveProfile(profile)
    XCTAssertFalse(saved)
    XCTAssertNotNil(model.error)
    model.profile = profile
    model.reset()
    XCTAssertNil(model.profile)
    XCTAssertNil(model.readiness)
  }
  func testDisconnectedReminderSaveReportsFailureInsteadOfClosingAsSuccessful() async {
    let model = DailySupportModel(store: ConnectionStore(connection: nil))
    model.beginReminder()
    await model.createReminder(title: "Check booking", due: Date().addingTimeInterval(3600), recurrence: "none")
    XCTAssertEqual(model.error, "Connect to Mochi before saving changes.")
    XCTAssertTrue(model.reminders.isEmpty)
    await model.refresh()
    XCTAssertEqual(model.error, "Connect to Mochi to load your day.")
  }
  func testSuccessfulReminderSaveKeepsRetryIDWhenFollowingRefreshFails() async throws {
    ReminderRefreshFailureFixture.log.reset()
    let connection = try Connection(baseURL: URL(string: "https://reminder.fixture")!, token: String(repeating: "x", count: 32))
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ReminderRefreshFailureFixture.self]
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let model = DailySupportModel(store: ConnectionStore(connection: connection), makeClient: { APIClient(connection: $0, session: session) })
    let due = Date().addingTimeInterval(3600)
    model.beginReminder()
    await model.createReminder(title: "Check booking", due: due, recurrence: "none")
    XCTAssertNotNil(model.error, "A failed refresh keeps the existing form available for retry")
    await model.createReminder(title: "Check booking", due: due, recurrence: "none")
    let retries = ReminderRefreshFailureFixture.log.snapshot()
    XCTAssertEqual(retries.count, 2)
    XCTAssertFalse(retries[0].isEmpty)
    XCTAssertEqual(retries[0], retries[1], "Retrying after the successful save must not create another reminder")
    model.beginReminder()
    await model.createReminder(title: "Check booking", due: due, recurrence: "none")
    let newForm = ReminderRefreshFailureFixture.log.snapshot()
    XCTAssertEqual(newForm.count, 3)
    XCTAssertNotEqual(newForm[1], newForm[2], "Explicitly starting a new form gets a new request ID")
  }
  func testBriefingQueryPreservesTimezoneAndKeepsTokenOutOfURL() throws {
    let connection = try Connection(baseURL: URL(string: "https://example.com")!, token: String(repeating: "x", count: 32))
    let request = APIClient(connection: connection).request("v1/briefing", query: [URLQueryItem(name: "timeZone", value: "Europe/London")])
    XCTAssertEqual(request.url?.path, "/v1/briefing")
    XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "Europe/London")
    XCTAssertFalse(request.url!.absoluteString.contains(connection.token))
    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(connection.token)")
  }
  func testGmailReviewPreservesExactContentAndOnlyRecoverableStatusesNeedReview() throws {
    for status in ["pending", "executing", "uncertain", "completed", "cancelled", "expired"] {
      let bytes = try JSONSerialization.data(withJSONObject: ["id": "draft-1", "sessionId": "source-session", "to": "person@example.com", "subject": "Exact subject", "body": "First line\nSecond line", "status": status, "expiresAt": 123456789])
      let draft = try JSONDecoder().decode(GmailDraftAction.self, from: bytes)
      XCTAssertEqual(draft.body, "First line\nSecond line")
      XCTAssertEqual(draft.to, "person@example.com")
      XCTAssertEqual(draft.sessionId, "source-session")
      XCTAssertEqual(draft.needsReview, ["pending", "executing", "uncertain"].contains(status))
    }
  }
  func testDailyResetClearsPrivateAccountDataAndErrors() throws {
    let connection = try Connection(baseURL: URL(string: "https://example.com")!, token: String(repeating: "x", count: 32))
    let model = DailySupportModel(store: ConnectionStore(connection: connection))
    model.briefing = try JSONDecoder().decode(DailyBriefing.self, from: Data(#"{"summary":"Private meeting","date":"2026-10-29","timeZone":"Europe/London","simulated":false,"sources":{"calendar":"available","gmail":"unavailable"}}"#.utf8))
    model.reminders = [try JSONDecoder().decode(MochiReminder.self, from: Data(#"{"id":"1","title":"Private reminder","dueAt":"2026-10-30T10:00:00Z","timeZone":"Europe/London","status":"pending","recurrence":"daily"}"#.utf8))]
    model.error = "Old account error"
    model.busy = true
    model.reset()
    XCTAssertNil(model.briefing)
    XCTAssertTrue(model.reminders.isEmpty)
    XCTAssertTrue(model.drafts.isEmpty)
    XCTAssertNil(model.error)
    XCTAssertFalse(model.busy)
  }
}

private final class ReminderRequestLog: @unchecked Sendable {
  private let lock = NSLock()
  private var ids: [String] = []
  func reset() { lock.lock(); defer { lock.unlock() }; ids = [] }
  func append(_ id: String) { lock.lock(); defer { lock.unlock() }; ids.append(id) }
  func snapshot() -> [String] { lock.lock(); defer { lock.unlock() }; return ids }
}
private final class ReminderRefreshFailureFixture: URLProtocol, @unchecked Sendable {
  static let log = ReminderRequestLog()
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let isSave = request.httpMethod == "POST" && request.url?.path == "/v1/reminders"
    if isSave {
      var body = request.httpBody ?? Data()
      if let stream = request.httpBodyStream {
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 1024)
        while true {
          let count = stream.read(&buffer, maxLength: buffer.count)
          if count <= 0 { break }
          body.append(contentsOf: buffer.prefix(count))
        }
      }
      let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: String]
      Self.log.append(payload?["id"] ?? "")
    }
    let body = isSave ? "{}" : #"{"error":{"message":"Refresh unavailable"}}"#
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: isSave ? 200 : 503, httpVersion: "HTTP/1.1", headerFields: nil)!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
