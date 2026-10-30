import Foundation

public enum Reactions {
  public static func choose(input: String, reply: String = "", state: String = "speak") -> Mood? {
    let input = input.lowercased().replacingOccurrences(of: "’", with: "'")
    let reply = reply.lowercased().replacingOccurrences(of: "’", with: "'")
    func matches(_ pattern: String, _ text: String) -> Bool {
      text.range(of: pattern, options: .regularExpression) != nil
    }
    guard ["speak", "clarify"].contains(state),
      !matches(
        #"\b(died|death|grief|funeral|suicide|hurt|injured|hospital|abuse|scared|depressed|lonely|crying|heartbroken|fired|laid off|bad news|sorry to hear)\b"#,
        input + " " + reply)
    else { return nil }
    let negative = matches(#"\b(not|never|hate|don't|aren't|isn't)\b"#, input)
    if !negative
      && matches(
        #"\b(i (?:(?:really|truly|absolutely|so|much)\s+)*love you|love you|good job|well done|you(?:'re| are) (?:(?:so|really|very|super|the) )*(?:cute|adorable|sweet|lovely|wonderful|amazing|awesome|great|best|helpful|kind|cool))\b"#,
        input)
    {
      return .loved
    }
    if matches(#"\b(i'm not sure|could you clarify|did you mean|not quite sure)\b"#, reply) {
      return .confused
    }
    if state == "clarify" { return .curious }
    if !negative
      && matches(
        #"\b(i (?:just )?(?:passed|won|graduated)|i got (?:the|a) (?:job|promotion)|we won|good news)\b"#,
        input)
    {
      return .delighted
    }
    if matches(#"\b(wow|that's unexpected|what a surprise|incredible)\b"#, reply) {
      return .surprised
    }
    if reply.hasSuffix("?") { return .curious }
    return nil
  }
}
public struct EndpointDetector: Sendable {
  private var start: Double?, last: Double?, lastVoice: Double?, partialAt: Double?
  private var voiceDuration = 0.0, noiseFloor = 0.0
  private var text = ""
  public private(set) var finished = false
  public init() {}
  public var hasSpeech: Bool { voiceDuration >= 0.25 || (voiceDuration >= 0.08 && !text.isEmpty) }
  public mutating func partial(_ value: String, at time: Double) {
    if value != text {
      text = value
      partialAt = time
    }
  }
  public mutating func sample(_ level: Double, at time: Double) -> Bool {
    if start == nil { start = time }
    let elapsed = min(0.2, max(0, time - (last ?? time)))
    last = time
    guard !finished else { return false }
    if level < 0.07 { noiseFloor += 0.05 * (level - noiseFloor) }
    if level >= max(0.07, noiseFloor * 2.5) {
      voiceDuration += elapsed
      lastVoice = time
    } else if voiceDuration < 0.25 && text.isEmpty, let lastVoice, time - lastVoice > 0.5 {
      voiceDuration = 0
    }
    let incomplete =
      text.range(
        of: #"\b(and|or|but|because|with|to|at|for|the|a|um|uh)\s*[,.…]*$"#,
        options: [.regularExpression, .caseInsensitive]) != nil
    let silence = incomplete ? 1.7 : text.isEmpty ? 1.1 : 0.9
    if hasSpeech, let lastVoice, time - lastVoice >= silence, time - (partialAt ?? 0) >= 0.3 {
      finished = true
      return true
    }
    return false
  }
  public func noInput(at time: Double) -> Bool { !hasSpeech && time - (start ?? time) >= 8 }
}
public struct SentenceBuffer: Sendable {
  private var consumed = 0
  private var previous = ""
  public init() {}
  public mutating func append(_ cumulative: String, final: Bool = false) throws -> [String] {
    guard cumulative.hasPrefix(previous), cumulative.count <= 2000 else {
      throw MochiError.message("The streamed reply changed unexpectedly.")
    }
    previous = cumulative
    let characters = Array(cumulative)
    var output: [String] = []
    var start = consumed
    if characters.count > start + 1 {
      for index in start..<(characters.count - 1)
      where ".!?".contains(characters[index]) && characters[index + 1].isWhitespace {
        let sentence = String(characters[start...index]).trimmingCharacters(
          in: .whitespacesAndNewlines)
        if !sentence.isEmpty { output.append(sentence) }
        start = index + 1
      }
    }
    if final && start < characters.count {
      let sentence = String(characters[start...]).trimmingCharacters(in: .whitespacesAndNewlines)
      if !sentence.isEmpty { output.append(sentence) }
      start = characters.count
    }
    consumed = start
    return output
  }
}
