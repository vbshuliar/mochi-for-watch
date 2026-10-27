import Foundation

extension AudioController: AudioIO {}
extension RealtimeTranscriber: TranscriptionIO {}
@MainActor extension ConversationModel {
  convenience init(store: ConnectionStore) {
    self.init(store: store, audio: AudioController(), transcriber: RealtimeTranscriber())
  }
}
