import AVFoundation
import Foundation
import MuseCore

// Conversion happens serially on the audio tap. Only Data and a scalar cross to MainActor.
private final class PCMConverter: @unchecked Sendable {
  let converter: AVAudioConverter
  let output: AVAudioFormat
  init(input: AVAudioFormat) throws {
    guard
      let output = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true),
      let converter = AVAudioConverter(from: input, to: output)
    else { throw MuseError.message("Microphone format is unavailable.") }
    self.output = output
    self.converter = converter
  }
  func convert(_ input: AVAudioPCMBuffer) -> (Data, Double)? {
    let capacity = AVAudioFrameCount(
      ceil(Double(input.frameLength) * 24000 / input.format.sampleRate) + 32)
    guard let converted = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: capacity) else {
      return nil
    }
    var supplied = false
    var error: NSError?
    let status = converter.convert(to: converted, error: &error) { _, outStatus in
      if supplied {
        outStatus.pointee = .noDataNow
        return nil
      }
      supplied = true
      outStatus.pointee = .haveData
      return input
    }
    guard status != .error, error == nil, let samples = converted.int16ChannelData?[0] else {
      return nil
    }
    let count = Int(converted.frameLength)
    guard count > 0 else { return nil }
    var sum = 0.0
    for i in 0..<count {
      let sample = Double(samples[i]) / 32768
      sum += sample * sample
    }
    return (Data(bytes: samples, count: count * 2), min(1, sqrt(sum / Double(count)) * 4))
  }
}
@MainActor final class AudioController: NSObject, AVAudioPlayerDelegate {
  private var recordingID = UUID()
  private var engine: AVAudioEngine?
  private var player: AVAudioPlayer?
  private var playback: CheckedContinuation<Void, Error>?
  private var interruption: NSObjectProtocol?
  private var routeChange: NSObjectProtocol?
  var onPCM: ((Data, Double) -> Void)?
  var onPlaybackStart: (() -> Void)?
  var onInterruption: (() -> Void)?
  override init() {
    super.init()
    interruption = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
    ) { [weak self] notification in
      guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
      Task { @MainActor in self?.onInterruption?() }
    }
    routeChange = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
    ) { [weak self] notification in
      guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
        AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
      Task { @MainActor in self?.onInterruption?() }
    }
  }
  func activate() async throws {
    let session = AVAudioSession.sharedInstance()
    #if os(iOS)
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
      try session.setActive(true)
    #else
      try session.setCategory(.playAndRecord, mode: .default, policy: .default, options: [])
      try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<Void, Error>) in
        session.activate(options: []) { success, error in
          if let error {
            continuation.resume(throwing: error)
          } else if success {
            continuation.resume()
          } else {
            continuation.resume(throwing: MuseError.message("Audio is unavailable right now."))
          }
        }
      }
    #endif
  }
  func startRecording() async throws {
    let allowed = await withCheckedContinuation { continuation in
      AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
    }
    guard allowed else {
      throw MuseError.message("Allow microphone access in Settings to talk to Tuck.")
    }
    try Task.checkCancellation()
    try await activate()
    try Task.checkCancellation()
    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw MuseError.message("No microphone is available.")
    }
    let converter = try PCMConverter(input: format)
    let ticket = UUID()
    recordingID = ticket
    input.installTap(onBus: 0, bufferSize: 1536, format: format) { [weak self] buffer, _ in
      guard let (data, level) = converter.convert(buffer) else { return }
      Task { @MainActor in if self?.recordingID == ticket { self?.onPCM?(data, level) } }
    }
    self.engine = engine
    engine.prepare()
    do { try engine.start() } catch {
      stopRecording()
      throw error
    }
  }
  func stopRecording() {
    recordingID = UUID()
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    engine = nil
  }
  func play(_ data: Data) async throws {
    try Task.checkCancellation()
    try await activate()
    try Task.checkCancellation()
    let player = try AVAudioPlayer(data: data)
    self.player = player
    player.delegate = self
    player.prepareToPlay()
    try await withCheckedThrowingContinuation { continuation in
      playback = continuation
      if player.play() {
        onPlaybackStart?()
      } else {
        playback = nil
        continuation.resume(throwing: MuseError.message("Couldn’t play Tuck’s voice."))
      }
    }
  }
  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor in
      guard self.player === player else { return }
      if flag {
        playback?.resume()
      } else {
        playback?.resume(throwing: MuseError.message("Voice playback stopped."))
      }
      playback = nil
      self.player = nil
    }
  }
  nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    Task { @MainActor in
      guard self.player === player else { return }
      playback?.resume(throwing: MuseError.message("Couldn’t decode Tuck’s voice."))
      playback = nil
      self.player = nil
    }
  }
  func stop() {
    stopRecording()
    player?.stop()
    player = nil
    playback?.resume(throwing: CancellationError())
    playback = nil
  }
  func deactivate() {
    stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
