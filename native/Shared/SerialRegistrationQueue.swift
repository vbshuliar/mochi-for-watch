import Foundation

/// Device registration and removal share one queue so a late removal cannot erase a newer grant.
@MainActor final class SerialRegistrationQueue {
  private var tail: Task<Void, Never>?
  @discardableResult func enqueue(_ operation: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
    let previous = tail
    let next = Task {
      await previous?.value
      await operation()
    }
    tail = next
    return next
  }
}
