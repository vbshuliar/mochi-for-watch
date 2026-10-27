import XCTest

@testable import MuseCore

private final class FixtureProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let path = request.url!.path
    let result =
      #"{"sessionId":"session","state":"speak","statusText":"speaking…","speechText":"Hello. Nice to see you!","simulated":true}"#
    let body: String
    let status: Int
    if path.contains("unauthorized") {
      status = 401
      body = #"{"error":{"message":"Please reconnect."}}"#
    } else if path.contains("truncated") {
      status = 200
      body = "{\"type\":\"text\",\"text\":\"Hello\"}\n"
    } else if path.hasSuffix("/stream") {
      status = 200
      body =
        "{\"type\":\"text\",\"text\":\"Hello. \"}\n{\"type\":\"result\",\"result\":\(result)}\n"
    } else {
      status = 200
      body = #"{"id":"session"}"#
    }
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/x-ndjson"])!, cacheStoragePolicy: .notAllowed)
    // Fragment deliberately inside JSON and Unicode boundaries.
    for byte in body.utf8 { client?.urlProtocol(self, didLoad: Data([byte])) }
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
private actor TextCollector {
  var values: [String] = []
  func append(_ text: String) { values.append(text) }
}
final class APIClientTests: XCTestCase, @unchecked Sendable {
  private func makeClient() throws -> APIClient {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [FixtureProtocol.self]
    return APIClient(
      connection: try Connection(
        baseURL: URL(string: "https://fixture.example")!, token: String(repeating: "t", count: 32)),
      session: URLSession(configuration: config))
  }
  func testStreamDeliversPartialAndFinalAcrossByteBoundaries() async throws {
    let collector = TextCollector()
    let result = try await makeClient().stream(
      sessionID: "session", requestID: UUID().uuidString, text: "Hi"
    ) { await collector.append($0) }
    XCTAssertEqual(result.speechText, "Hello. Nice to see you!")
    let values = await collector.values
    XCTAssertEqual(values, ["Hello. "])
  }
  func testIncompleteStreamFailsInsteadOfClaimingSuccess() async throws {
    do {
      _ = try await makeClient().stream(
        sessionID: "truncated", requestID: UUID().uuidString, text: "Hi"
      ) { _ in }
      XCTFail("Expected incomplete stream error")
    } catch { XCTAssertTrue(error.localizedDescription.contains("ended early")) }
  }
  func testAuthenticationFailureUsesSafeServerMessage() async throws {
    do {
      _ = try await makeClient().data("unauthorized")
      XCTFail("Expected error")
    } catch { XCTAssertEqual(error.localizedDescription, "Please reconnect.") }
  }
  func testSessionDecodesContract() async throws {
    let session = try await makeClient().createSession()
    XCTAssertEqual(session, "session")
  }
}
