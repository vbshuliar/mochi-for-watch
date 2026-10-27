import MuseCore
import SwiftUI

struct ActionReview: View {
  let action: Action
  let busy: Bool
  let decide: (Bool) -> Void
  private func date(_ raw: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let value = parser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    guard let value else { return raw }
    let formatter = DateFormatter()
    formatter.timeZone = TimeZone(identifier: action.event.timeZone)
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: value)
  }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        Text("Review event").font(.headline)
        Text(action.event.title).font(.title3.bold())
        Text(date(action.event.start))
        Text("until \(date(action.event.end))")
        Text(action.event.timeZone).font(.caption).foregroundStyle(.secondary)
        Text(
          action.status == "uncertain"
            ? "The last save wasn’t verified. Check it before trying again."
            : "Nothing is saved until you confirm."
        ).font(.caption)
        Button(action.status == "uncertain" ? "Verify save" : "Add to Calendar") { decide(true) }
          .buttonStyle(.borderedProminent).disabled(busy)
        Button("Cancel", role: .cancel) { decide(false) }.disabled(
          busy || action.status == "uncertain")
        if busy { ProgressView("saving…") }
      }.padding()
    }
  }
}
