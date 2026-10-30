import Contacts
import Foundation

/// Each device searches only its OS-synced contacts; no address book is transferred.
actor DeviceContacts: ContactSearching {
  func search(_ query: String, requestingAccess: @escaping @Sendable (Bool) async -> Void) async -> LocalContactResult {
    guard !Task.isCancelled else { return .unavailable }
    let store = CNContactStore()
    var status = CNContactStore.authorizationStatus(for: .contacts)
    if status == .notDetermined {
      await requestingAccess(true)
      guard !Task.isCancelled else { await requestingAccess(false); return .unavailable }
      do { _ = try await store.requestAccess(for: .contacts) } catch {
        await requestingAccess(false)
        return .denied
      }
      await requestingAccess(false)
      status = CNContactStore.authorizationStatus(for: .contacts)
    }
    guard !Task.isCancelled else { return .unavailable }
    if status == .denied || status == .restricted { return .denied }
    // Limited authorization is raw value 4 on supported OS releases. Searching
    // uses the same API and returns only contacts the owner has shared.
    let limited = status.rawValue == 4
    guard status == .authorized || limited else { return .unavailable }
    do {
      let contacts = try store.unifiedContacts(matching: CNContact.predicateForContacts(matchingName: query), keysToFetch: [CNContactGivenNameKey as CNKeyDescriptor, CNContactFamilyNameKey as CNKeyDescriptor, CNContactOrganizationNameKey as CNKeyDescriptor, CNContactPhoneNumbersKey as CNKeyDescriptor])
      guard !Task.isCancelled else { return .unavailable }
      let candidates = contacts.prefix(50).flatMap { contact in
        let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
        return contact.phoneNumbers.prefix(10).map { number in
          LocalContact(id: contact.identifier + number.identifier, displayName: name.isEmpty ? contact.organizationName : name, phoneNumber: number.value.stringValue, phoneLabel: number.label.map { CNLabeledValue<NSString>.localizedString(forLabel: $0) })
        }
      }
      return .matches(candidates, limited: limited)
    } catch { return .unavailable }
  }
}
