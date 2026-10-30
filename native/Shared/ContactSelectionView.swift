import SwiftUI

struct ContactSelectionView: View {
  let model: ConversationModel
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        Text("Choose who Mochi calls").font(.headline)
        Text(model.contactMessage).font(.footnote)
        ForEach(model.contactCandidates) { contact in
          Button { model.selectContact(contact) } label: {
            VStack(alignment: .leading) {
              Text(contact.displayName)
              Text([contact.phoneLabel, contact.phoneNumber].compactMap { $0 }.joined(separator: " · ")).font(.caption)
              if contact.internationalNumber == nil { Text("Add +country code in Contacts").font(.caption) }
            }.frame(maxWidth: .infinity, alignment: .leading)
          }.disabled(contact.internationalNumber == nil)
        }
        if model.contactCanRetry {
          Button("Retry selection") { model.retryContactSubmission() }
        } else if model.contactCandidates.isEmpty && !model.contactBusy {
          Button("Search device contacts") { model.searchContacts() }
        }
        if model.contactBusy { ProgressView("Working…") }
        Button("Cancel", role: .cancel) { model.cancelContactLookup() }

      }.padding()
    }.interactiveDismissDisabled()
  }
}
