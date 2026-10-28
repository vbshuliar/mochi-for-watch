import MuseCore
import XCTest

#if canImport(MusePhone)
  @testable import MusePhone
#else
  @testable import MuseConversation
#endif

@MainActor private final class FakeAudio: AudioIO {
  var onPCM: ((Data, Double) -> Void)?
  var onPlaybackStart: (() -> Void)?
  var onInterruption: (() -> Void)?
  var played = 0, recording = false
  var denyMicrophone = false
  var finish: CheckedContinuation<Void, Error>?
  func startRecording() async throws {
    if denyMicrophone { throw MuseError.message("Microphone permission denied.") }
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
    if path.hasSuffix("/sessions") {
      body = #"{"id":"test-session"}"#
    } else if path.contains("/calls/") {
      body = "{\"callAction\":" + callFixture + "}"
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
        url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!,
      cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
@MainActor final class NativeConversationTests: XCTestCase {
  private func makeModel() throws -> (ConversationModel, FakeAudio) {
    let connection = try Connection(
      baseURL: URL(string: "https://native.fixture")!, token: String(repeating: "t", count: 32))
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [NativeFixture.self]
    let session = URLSession(configuration: config)
    let audio = FakeAudio()
    let model = ConversationModel(
      store: ConnectionStore(connection: connection), audio: audio, transcriber: FakeTranscript(),
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
    model.sendText("Hey Jolly, I really love you!")
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
