import Foundation

public struct APIClient: Sendable {
  public let connection: Connection
  private let session: URLSession
  public init(connection: Connection, session: URLSession = .shared) {
    self.connection = connection
    self.session = session
  }
  public static func redeemPairing(baseURL: URL, code: String, session: URLSession = .shared) async throws -> Connection {
    _ = try Connection(baseURL: baseURL, token: String(repeating: "x", count: 32))
    let normalized = code.uppercased().filter { !$0.isWhitespace && $0 != "-" }
    guard normalized.count == 16, normalized.allSatisfy({ "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains($0) }) else {
      throw MuseError.message("Enter the 16-character pairing code from your backend.")
    }
    var request = URLRequest(url: baseURL.appendingPathComponent("v1/pairing/redeem"), timeoutInterval: 30)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(["code": normalized])
    let (data, response) = try await session.data(for: request, delegate: PairingRedirectPolicy())
    try validate(response, data: data)
    struct Pairing: Decodable { let token: String; let deviceId: String; let expiresAt: Double }
    let pairing = try JSONDecoder().decode(Pairing.self, from: data)
    guard pairing.expiresAt > Date().timeIntervalSince1970 * 1000 else { throw MuseError.message("This connection has expired. Request a new pairing code.") }
    return try Connection(baseURL: baseURL, token: pairing.token)
  }
  public func request(
    _ path: String, method: String = "GET", body: Data? = nil,
    contentType: String = "application/json", requestID: String? = nil, query: [URLQueryItem] = []
  ) -> URLRequest {
    var components = URLComponents(url: connection.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
    if !query.isEmpty { components.queryItems = query }
    var request = URLRequest(url: components.url!, timeoutInterval: 95)
    request.httpMethod = method
    request.httpBody = body
    request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
    if body != nil { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
    if let requestID { request.setValue(requestID, forHTTPHeaderField: "Idempotency-Key") }
    return request
  }
  public func data(
    _ path: String, method: String = "GET", body: Data? = nil,
    contentType: String = "application/json", requestID: String? = nil, query: [URLQueryItem] = []
  ) async throws -> Data {
    let (data, response) = try await session.data(
      for: request(path, method: method, body: body, contentType: contentType, requestID: requestID, query: query)
    )
    try Self.validate(response, data: data)
    return data
  }
  public func get<T: Decodable & Sendable>(_ path: String, as: T.Type, query: [URLQueryItem] = []) async throws -> T {
    try JSONDecoder().decode(T.self, from: await data(path, query: query))
  }
  public func json(_ path: String, method: String = "POST", values: [String: String]) async throws
    -> Data
  {
    try await data(path, method: method, body: JSONEncoder().encode(values))
  }
  public func createSession() async throws -> String {
    struct Created: Decodable { let id: String }
    return try JSONDecoder().decode(
      Created.self,
      from: await json("v1/sessions", values: ["timeZone": TimeZone.current.identifier])
    ).id
  }
  public func cancel(sessionID: String, requestID: String) async throws {
    _ = try await json("v1/sessions/\(sessionID)/turns/\(requestID)/cancel", values: [:])
  }
  public func speech(_ text: String) async throws -> Data {
    try await json("v1/speech", values: ["text": text])
  }
  public func stream(
    sessionID: String, requestID: String, text: String, onText: @Sendable (String) async -> Void
  ) async throws -> TurnResult {
    let body = try JSONEncoder().encode(["requestId": requestID, "text": text])
    let (bytes, response) = try await session.bytes(
      for: request("v1/sessions/\(sessionID)/stream", method: "POST", body: body))
    try Self.validate(response)
    // Bound each line before decoding; a malformed server cannot grow memory without limit.
    var line = Data()
    for try await byte in bytes {
      try Task.checkCancellation()
      if byte != 10 {
        line.append(byte)
        guard line.count <= 65536 else { throw MuseError.message("Reply was too large.") }
        continue
      }
      guard !line.isEmpty else { continue }
      let event = try JSONDecoder().decode(StreamEvent.self, from: line)
      line.removeAll(keepingCapacity: true)
      switch event.type {
      case "text": if let text = event.text { await onText(text) }
      case "result": if let result = event.result { return result }
      case "error": throw MuseError.message(event.message ?? "Mochi couldn’t finish that reply.")
      default: throw MuseError.message("Unexpected reply from the server.")
      }
    }
    throw MuseError.message("The reply ended early. Please try again.")
  }
  private static func validate(_ response: URLResponse, data: Data? = nil) throws {
    guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode)
    else {
      struct Envelope: Decodable {
        struct Failure: Decodable { let message: String }
        let error: Failure
      }
      if let data, let error = try? JSONDecoder().decode(Envelope.self, from: data) {
        throw MuseError.message(error.error.message)
      }
      throw MuseError.message("Couldn’t reach Mochi. Check your connection and try again.")
    }
  }
}

// A pairing code is authority to issue a device token. Never forward it to a redirect target.
private final class PairingRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}
