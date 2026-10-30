import Foundation
import MochiCore
import XCTest
#if canImport(MochiPhone)
@testable import MochiPhone
#else
@testable import MochiConversation
#endif

private actor ContactFake: ContactSearching {
  let result: LocalContactResult
  var searches = 0
  let delay: Bool
  let prompt: Bool
  init(_ result: LocalContactResult, delay: Bool = false, prompt: Bool = false) { self.result = result; self.delay = delay; self.prompt = prompt }
  func search(_ query: String, requestingAccess: @escaping @Sendable (Bool) async -> Void) async -> LocalContactResult {
    searches += 1
    if prompt { await requestingAccess(true) }
    if delay { try? await Task.sleep(for: .milliseconds(150)) }
    if prompt { await requestingAccess(false) }
    return result
  }
}
@MainActor private final class ContactAudio: AudioIO {
  var onPCM: ((Data, Double) -> Void)?
  var onPlaybackStart: (() -> Void)?
  var onInterruption: (() -> Void)?
  func startRecording() async throws {}
  func stopRecording() {}
  func play(_ data: Data) async throws {}
  func stop() {}
  func deactivate() {}
}
@MainActor private final class ContactTranscript: TranscriptionIO {
  var onPartial: ((String) -> Void)?
  func start(client: APIClient) {}
  func append(_ pcm: Data) {}
  func finish() async throws -> String { throw URLError(.notConnectedToInternet) }
  func cancel() {}
}
private final class ContactFixture: URLProtocol, @unchecked Sendable {
  private static let lock = NSLock()
  nonisolated(unsafe) private static var attempts: [Data] = []
  static func recordedAttempts(reset: Bool = false) -> [Data] {
    lock.lock(); defer { lock.unlock() }
    let result = attempts
    if reset { attempts = [] }
    return result
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let path = request.url!.path
    let body: String
    var responseStatus = 200
    if path.hasSuffix("/sessions") { body = #"{"id":"synthetic-session"}"# }
    else if path.hasSuffix("/audio") {
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Contact-Lookup-Supported"), "true")
      body = #"{"sessionId":"synthetic-session","state":"clarify","statusText":"Choose contact","speechText":"Choose Alex.","simulated":true,"contactLookup":{"id":"lookup","query":"Alex","expiresAt":9999999999999}}"#
    }
    else if path.hasSuffix("/stream") {
      body = #"{"type":"result","result":{"sessionId":"synthetic-session","state":"clarify","statusText":"Choose contact","speechText":"Choose Alex.","simulated":true,"contactLookup":{"id":"lookup","query":"Alex","expiresAt":9999999999999}}}"# + "\n"
    } else if path.contains("contact-lookups") {
      var data = request.httpBody
      if data == nil, let stream = request.httpBodyStream {
        stream.open(); defer { stream.close() }
        var bytes = [UInt8](repeating: 0, count: 4096); var buffer = Data()
        while stream.hasBytesAvailable { let count = stream.read(&bytes, maxLength: bytes.count); if count <= 0 { break }; buffer.append(bytes, count: count) }
        data = buffer
      }
      let payload = (try? JSONSerialization.jsonObject(with: data ?? Data())) as? [String: Any]
      let status = payload?["status"] as? String ?? "missing"
      if status == "selected" {
        let contact = payload?["contact"] as? [String: String]
        XCTAssertEqual(contact?["phoneNumber"], "+442012345678")
        XCTAssertEqual(contact?["displayName"], "Alex")
        XCTAssertNil(payload?["contacts"])
      }
      if request.value(forHTTPHeaderField: "Authorization")?.contains(String(repeating: "f", count: 32)) == true {
        Self.lock.lock(); Self.attempts.append(data ?? Data()); Self.lock.unlock()
        responseStatus = 403
        body = #"{"error":{"message":"This destination is not enabled for calls."}}"#
      } else {
        body = "{\"sessionId\":\"synthetic-session\",\"state\":\"idle\",\"statusText\":\"Done\",\"speechText\":\"\(status)\",\"simulated\":true}"
      }
    } else { body = "synthetic audio" }
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: responseStatus, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
@MainActor final class ContactTests: XCTestCase {
  private let alex = LocalContact(id: "synthetic", displayName: "Alex", phoneNumber: "+44 (20) 1234-5678", phoneLabel: "mobile")
  private func model(_ contacts: ContactFake, audio: ContactAudio = ContactAudio(), fails: Bool = false) throws -> ConversationModel {
    let connection = try Connection(baseURL: URL(string: "https://contacts.fixture")!, token: String(repeating: fails ? "f" : "t", count: 32))
    let store = ConnectionStore(connection: connection)
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ContactFixture.self]
    let session = URLSession(configuration: config)
    return ConversationModel(store: store, audio: audio, transcriber: ContactTranscript(), contacts: contacts, makeClient: { APIClient(connection: $0, session: session) })
  }
  private func settle() async { try? await Task.sleep(for: .milliseconds(250)) }
  func testExplicitSearchAndSingleSelectionOnly() async throws {
    let contacts = ContactFake(.matches([alex], limited: true)); let model = try model(contacts)
    model.sendText("Call Alex"); await settle()
    let count = await contacts.searches; XCTAssertEqual(count, 0)
    model.searchContacts(); await settle()
    XCTAssertEqual(model.contactCandidates, [alex]); XCTAssertNotNil(model.contactLookup)
    XCTAssertTrue(model.contactMessage.contains("shared"))
    model.selectContact(alex); await settle()
    XCTAssertEqual(model.reply, "selected"); XCTAssertTrue(model.contactCandidates.isEmpty)
  }
  func testPermissionAlertInactiveSurvivesButBackgroundClears() async throws {
    for background in [false, true] {
      let model = try model(ContactFake(.matches([alex], limited: false), delay: true, prompt: true))
      model.sendText("Call Alex"); await settle(); model.searchContacts()
      try? await Task.sleep(for: .milliseconds(30))
      model.becameInactive()
      XCTAssertNotNil(model.contactLookup)
      if background { model.suspend() }
      await settle()
      XCTAssertEqual(model.contactCandidates.isEmpty, background)
      if !background { model.becameInactive(); XCTAssertNil(model.contactLookup) }
    }
  }
  func testMultiplePeopleAndNumbersRequireSelection() async throws {
    let other = LocalContact(id: "other", displayName: "Alex Other", phoneNumber: "+442012345679", phoneLabel: "home")
    let mobile = LocalContact(id: "second-number", displayName: "Alex", phoneNumber: "+442012345680", phoneLabel: "work")
    let model = try model(ContactFake(.matches([alex, other, mobile], limited: false)))
    model.sendText("Call Alex"); await settle(); model.searchContacts(); await settle()
    XCTAssertEqual(model.contactCandidates.count, 3); XCTAssertEqual(model.reply, "Choose Alex.")
    model.selectContact(alex); await settle(); XCTAssertEqual(model.reply, "selected")
  }
  func testDeniedAndNoMatches() async throws {
    for (result, status) in [(LocalContactResult.denied, "denied"), (.matches([], limited: false), "not_found"), (.unavailable, "unavailable")] {
      let model = try model(ContactFake(result)); model.sendText("Call Alex"); await settle()
      model.searchContacts(); await settle(); XCTAssertEqual(model.reply, status); XCTAssertNil(model.contactLookup)
    }
  }
  func testInterruptionAndConnectionChangeDiscardLateSearch() async throws {
    for change in [false, true] {
      let model = try model(ContactFake(.matches([alex], limited: false), delay: true))
      model.sendText("Call Alex"); await settle(); model.searchContacts()
      if change { model.connectionChanged() } else { model.suspend() }
      await settle(); XCTAssertTrue(model.contactCandidates.isEmpty); XCTAssertNil(model.contactLookup)
    }
  }
  func testCancelClearsCandidates() async throws {
    let model = try model(ContactFake(.matches([alex], limited: false)))
    model.sendText("Call Alex"); await settle(); model.searchContacts(); await settle()
    model.cancelContactLookup(); await settle(); XCTAssertEqual(model.reply, "cancelled"); XCTAssertTrue(model.contactCandidates.isEmpty)
  }
  func testCancelDuringSearchAndAfterFailedSelection() async throws {
    let searching = try model(ContactFake(.matches([alex], limited: false), delay: true))
    searching.sendText("Call Alex"); await settle(); searching.searchContacts(); searching.cancelContactLookup()
    await settle(); XCTAssertNil(searching.contactLookup); XCTAssertTrue(searching.contactCandidates.isEmpty)
    _ = ContactFixture.recordedAttempts(reset: true)
    let failed = try model(ContactFake(.matches([alex], limited: false)), fails: true)
    failed.sendText("Call Alex"); await settle(); failed.searchContacts(); await settle(); failed.selectContact(alex); await settle()
    XCTAssertTrue(failed.contactCanRetry); XCTAssertTrue(failed.contactMessage.contains("not enabled"))
    failed.retryContactSubmission(); await settle()
    let attempts = ContactFixture.recordedAttempts()
    XCTAssertEqual(attempts.count, 2); XCTAssertEqual(attempts.first, attempts.last)
    failed.cancelContactLookup(); XCTAssertNil(failed.contactLookup); XCTAssertFalse(failed.contactCanRetry)
  }
  func testAudioFallbackOffersContactSelection() async throws {
    let audio = ContactAudio()
    let model = try model(ContactFake(.matches([alex], limited: false)), audio: audio)
    model.tap(); await settle()
    for _ in 0..<4 {
      audio.onPCM?(Data(repeating: 0, count: 4800), 1)
      try? await Task.sleep(for: .milliseconds(110))
    }
    model.tap(); await settle()
    XCTAssertNotNil(model.contactLookup); XCTAssertTrue(model.contactCandidates.isEmpty)
    model.searchContacts(); await settle(); XCTAssertEqual(model.contactCandidates, [alex])
  }
  func testConservativeInternationalNumbersAndGenericDecode() throws {
    XCTAssertEqual(alex.internationalNumber, "+442012345678")
    for number in ["02012345678", "00442012345678", "+44 20 1234 ext 2", "+0123456789"] {
      XCTAssertNil(LocalContact(id: "x", displayName: "Alex", phoneNumber: number, phoneLabel: nil).internationalNumber)
    }
    let call = try JSONDecoder().decode(CallAction.self, from: Data(#"{"id":"call","sessionId":"session","status":"completed","expiresAt":9999999999999,"calendarChecked":false,"operation":"conversation","outcome":"completed_request","booking":{"destinationName":"Alex","phoneNumber":"+442012345678","purpose":"Tell Alex I am late","customerName":"Owner","timeZone":"Europe/London"}}"#.utf8))
    XCTAssertTrue(call.isConversation); XCTAssertEqual(call.resultTitle, "call update"); XCTAssertFalse(call.booked)
    XCTAssertTrue(call.booking.allowedWindows.isEmpty); XCTAssertNil(call.booking.durationMinutes)
  }
}
