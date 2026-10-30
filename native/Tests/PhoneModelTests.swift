import Foundation
import MochiCore
import XCTest

#if canImport(MochiPhone)
  @testable import MochiPhone
#else
  @testable import MochiConversation
#endif

private final class PhoneFixture: URLProtocol, @unchecked Sendable {
  final class Queue: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: [PhoneFixture] = []
    func append(_ request: PhoneFixture) { lock.lock(); defer { lock.unlock() }; pending.append(request) }
    func take() -> PhoneFixture? { lock.lock(); defer { lock.unlock() }; return pending.isEmpty ? nil : pending.removeFirst() }
  }
  static let queue = Queue()
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { Self.queue.append(self) }
  override func stopLoading() {}
  func respond(_ body: String, status: Int = 200) {
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
}

@MainActor final class PhoneModelTests: XCTestCase {
  private func model() throws -> PhoneModel {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [PhoneFixture.self]
    let session = URLSession(configuration: configuration)
    let connection = try Connection(baseURL: URL(string: "https://phone.test")!, token: String(repeating: "a", count: 32))
    return PhoneModel(store: ConnectionStore(connection: connection), makeClient: { APIClient(connection: $0, session: session) })
  }
  private func request() async throws -> PhoneFixture {
    for _ in 0..<200 {
      if let request = PhoneFixture.queue.take() { return request }
      try await Task.sleep(for: .milliseconds(5))
    }
    throw MochiError.message("Test request did not arrive")
  }
  private func status(_ calendar: String) -> String {
    #"{"mode":"live","calendar":"\#(calendar)","calendarEnabled":true,"calendarConfigured":true,"speechOutput":"voice"}"#
  }
  func testOldStatusCannotOverwriteStatusAfterConnectionReset() async throws {
    let model = try model()
    let old = Task { await model.refresh() }
    let oldRequest = try await request()
    model.connectionChanged()
    let fresh = Task { await model.refresh() }
    let newRequest = try await request()
    newRequest.respond(status("connected"))
    await fresh.value
    oldRequest.respond(status("disconnected"))
    await old.value
    XCTAssertEqual(model.status?.calendar, "connected")
    XCTAssertNil(model.error)
  }
  func testOldFailureDoesNotUnlockNewRequestOrLeakError() async throws {
    let model = try model()
    let old = Task { await model.loadNotionPages("old") }
    let oldRequest = try await request()
    model.connectionChanged()
    let fresh = Task { await model.loadNotionPages("new") }
    let newRequest = try await request()
    oldRequest.respond(#"{"error":{"message":"Old backend private error"}}"#, status: 503)
    await old.value
    XCTAssertTrue(model.busy)
    XCTAssertNil(model.error)
    newRequest.respond(#"{"pages":[{"id":"new-page","title":"New notes"}],"hasMore":false}"#)
    await fresh.value
    XCTAssertFalse(model.busy)
    XCTAssertEqual(model.notionPages.map(\.title), ["New notes"])
  }
  func testOldMemoryMutationDoesNotRefreshNewConnectionOrReportSuccess() async throws {
    let model = try model()
    let old = Task { await model.saveMemory(id: nil, title: "Old", text: "Private") }
    let pending = try await request()
    model.connectionChanged()
    pending.respond("{}")
    let saved = await old.value
    XCTAssertFalse(saved)
    XCTAssertFalse(model.memoryBusy)
    XCTAssertNil(model.memoryError)
    XCTAssertNil(PhoneFixture.queue.take())
  }
  func testResetClearsCachedPrivateDataAndRejectsOldSignInURL() async throws {
    let model = try model()
    model.notionPages = try JSONDecoder().decode([NotionPage].self, from: Data(#"[{"id":"old-page","title":"Private notes"}]"#.utf8))
    model.notionHasMore = true
    model.error = "Old error"
    model.memoryError = "Old memory error"
    let pending = Task { await model.connectWorkspace("gmail") }
    let request = try await request()
    model.connectionChanged()
    XCTAssertTrue(model.notionPages.isEmpty)
    XCTAssertFalse(model.notionHasMore)
    XCTAssertNil(model.error)
    XCTAssertNil(model.memoryError)
    request.respond(#"{"url":"https://accounts.google.com/o/oauth2/v2/auth?state=old"}"#)
    let url = await pending.value
    XCTAssertNil(url)
    XCTAssertFalse(model.busy)
  }
}
