import Foundation
import MuseCore

@MainActor protocol AudioIO: AnyObject {
  var onPCM: ((Data, Double) -> Void)? { get set }
  var onPlaybackStart: (() -> Void)? { get set }
  var onInterruption: (() -> Void)? { get set }
  func startRecording() async throws
  func stopRecording()
  func play(_ data: Data) async throws
  func stop()
  func deactivate()
}
@MainActor protocol TranscriptionIO: AnyObject {
  var onPartial: ((String) -> Void)? { get set }
  func start(client: APIClient)
  func append(_ pcm: Data)
  func finish() async throws -> String
  func cancel()
}
