import Foundation

public enum WAV {
  public static func encode(pcm: Data) -> Data {
    var data = Data()
    func ascii(_ text: String) { data.append(contentsOf: text.utf8) }
    func u16(_ value: UInt16) {
      var v = value.littleEndian
      withUnsafeBytes(of: &v) { data.append(contentsOf: $0) }
    }
    func u32(_ value: UInt32) {
      var v = value.littleEndian
      withUnsafeBytes(of: &v) { data.append(contentsOf: $0) }
    }
    ascii("RIFF")
    u32(UInt32(pcm.count + 36))
    ascii("WAVEfmt ")
    u32(16)
    u16(1)
    u16(1)
    u32(24000)
    u32(48000)
    u16(2)
    u16(16)
    ascii("data")
    u32(UInt32(pcm.count))
    data.append(pcm)
    return data
  }
}
