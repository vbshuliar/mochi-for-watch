import XCTest

@testable import MuseCore

final class ConversationTests: XCTestCase {
  func testCredentialsRejectInsecureRemoteAndEmbeddedSecrets() throws {
    XCTAssertThrowsError(
      try Connection(
        baseURL: URL(string: "http://example.com")!, token: String(repeating: "a", count: 32)))
    XCTAssertThrowsError(
      try Connection(
        baseURL: URL(string: "https://user:secret@example.com")!,
        token: String(repeating: "a", count: 32)))
    XCTAssertNoThrow(
      try Connection(
        baseURL: URL(string: "http://127.0.0.1:8787")!, token: String(repeating: "a", count: 32)))
    let invalid = Data(
      #"{"baseURL":"http://example.com","token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#.utf8)
    XCTAssertThrowsError(try JSONDecoder().decode(Connection.self, from: invalid))
  }
  func testAffectionVariantsAndSeriousContext() {
    XCTAssertEqual(Reactions.choose(input: "Hey Tuck, I really love you!"), .loved)
    XCTAssertNil(Reactions.choose(input: "I don't really love you"))
    XCTAssertNil(Reactions.choose(input: "My dog died, you are so sweet"))
    XCTAssertEqual(
      Reactions.choose(input: "I passed my exam", reply: "Congratulations!"), .delighted)
    XCTAssertNil(Reactions.choose(input: "you are amazing", state: "approval"))
  }
  func testSentenceStreamingNeverDuplicatesAndDetectsRewrites() throws {
    var buffer = SentenceBuffer()
    XCTAssertEqual(try buffer.append("Hello"), [])
    XCTAssertEqual(try buffer.append("Hello. How"), ["Hello."])
    XCTAssertEqual(try buffer.append("Hello. How are you?"), [])
    XCTAssertEqual(try buffer.append("Hello. How are you?", final: true), ["How are you?"])
    XCTAssertEqual(try buffer.append("Hello. How are you?", final: true), [])
    XCTAssertThrowsError(try buffer.append("Different reply"))
  }
  func testEndpointWaitsForSpeechThenPauseAndIgnoresNoise() {
    var detector = EndpointDetector()
    for i in 0..<20 { XCTAssertFalse(detector.sample(0, at: Double(i) * 0.1)) }
    XCTAssertFalse(detector.hasSpeech)
    for i in 20..<27 { XCTAssertFalse(detector.sample(0.2, at: Double(i) * 0.1)) }
    XCTAssertTrue(detector.hasSpeech)
    XCTAssertFalse(detector.sample(0, at: 3.0))
    XCTAssertTrue(detector.sample(0, at: 3.8))
    XCTAssertFalse(detector.sample(0, at: 4.0))
  }
  func testIncompletePhraseGetsMoreTime() {
    var detector = EndpointDetector()
    for i in 0..<6 { _ = detector.sample(0.3, at: Double(i) * 0.1) }
    detector.partial("schedule lunch with", at: 0.6)
    XCTAssertFalse(detector.sample(0, at: 1.6))
    XCTAssertTrue(detector.sample(0, at: 2.3))
  }
  func testWAVHeaderMatchesMonoPCMContract() {
    let pcm = Data(repeating: 0, count: 48000)
    let wav = WAV.encode(pcm: pcm)
    XCTAssertEqual(wav.count, pcm.count + 44)
    XCTAssertEqual(String(data: wav.prefix(4), encoding: .ascii), "RIFF")
    XCTAssertEqual(String(data: wav[8..<16], encoding: .ascii), "WAVEfmt ")
    XCTAssertEqual(Array(wav[22..<24]), [1, 0])
    XCTAssertEqual(Array(wav[34..<36]), [16, 0])
    XCTAssertEqual(Data(wav.suffix(pcm.count)), pcm)
  }
  func testMotionHasBoundedScaleAndSettlesExactly() {
    for mood in Mood.allCases {
      for i in 0..<100 {
        let pose = JollyMotion.pose(mood, time: Double(i) / 10, level: 1)
        XCTAssertTrue(pose.angle.isFinite)
        XCTAssertLessThanOrEqual(pose.scale, 1.13)
        XCTAssertGreaterThanOrEqual(pose.eye, 0)
      }
    }
    let talk = JollyMotion.pose(.speak, time: 0.2)
    let idle = JollyMotion.pose(.idle, time: 0)
    XCTAssertEqual(
      talk.blended(to: idle, progress: JollyMotion.ease(1)).angle, idle.angle, accuracy: 0.0001)
    XCTAssertEqual(JollyMotion.pose(.think, time: 2, reduced: true).angle, 0)
  }
  func testRequestHasAuthorizationHeaderNeverURLToken() throws {
    let token = String(repeating: "z", count: 32)
    let client = APIClient(
      connection: try Connection(baseURL: URL(string: "https://example.com")!, token: token))
    let request = client.request("v1/status")
    XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/status")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(token)")
  }
}
