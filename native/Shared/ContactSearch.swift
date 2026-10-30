import Foundation
import MochiCore

struct LocalContact: Identifiable, Equatable, Sendable {
  let id: String
  let displayName: String
  let phoneNumber: String
  let phoneLabel: String?
  var internationalNumber: String? {
    let value = phoneNumber.filter { !" ()-.".contains($0) }
    guard value.first == "+", (9...16).contains(value.count),
      value.dropFirst().first != "0", value.dropFirst().allSatisfy({ "0123456789".contains($0) }) else { return nil }
    return value
  }
}
enum LocalContactResult: Sendable {
  case matches([LocalContact], limited: Bool)
  case denied
  case unavailable
}
protocol ContactSearching: Sendable {
  func search(_ query: String, requestingAccess: @escaping @Sendable (Bool) async -> Void) async -> LocalContactResult
}
struct UnavailableContacts: ContactSearching {
  func search(_ query: String, requestingAccess: @escaping @Sendable (Bool) async -> Void) async -> LocalContactResult { .unavailable }
}
