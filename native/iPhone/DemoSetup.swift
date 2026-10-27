#if DEBUG
  import SwiftUI
  import UniformTypeIdentifiers
  import MuseCore

  struct DemoSetup: View {
    let store: ConnectionStore
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var error: String?
    @State private var address = ""
    @State private var token = ""
    var body: some View {
      NavigationStack {
        Form {
          Section {
            Text(
              "Import the private connection file generated on your Mac. It connects this phone and your paired Watch to your own backend."
            )
            Button("Import connection file") { importing = true }
            if store.connection != nil { Button("Sync with Apple Watch") { saved() } }
          } footer: {
            Text(
              "This is only for the development build. Never share this file or commit it to Git.")
          }
          Section {
            TextField("Backend HTTPS address", text: $address)
              .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            SecureField("App access token (API_TOKEN)", text: $token)
              .textInputAutocapitalization(.never).autocorrectionDisabled().privacySensitive()
            Button("Save connection") {
              do {
                guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines))
                else { throw MuseError.message("Enter a valid backend address.") }
                try store.save(
                  Connection(
                    baseURL: url, token: token.trimmingCharacters(in: .whitespacesAndNewlines)))
                token = ""
                saved()
                dismiss()
              } catch { self.error = error.localizedDescription }
            }.disabled(address.isEmpty || token.isEmpty)
          } header: { Text("Or enter the demo connection") } footer: {
            Text("Use the app access token from your backend, not a Meta or ElevenLabs API key.")
          }
          if let error { Section { Text(error).foregroundStyle(.red) } }
        }.navigationTitle("Demo connection")
          .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
          .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            do {
              let url = try result.get()
              let access = url.startAccessingSecurityScopedResource()
              defer { if access { url.stopAccessingSecurityScopedResource() } }
              let data = try Data(contentsOf: url)
              guard data.count < 16384 else {
                throw MuseError.message("That isn’t a connection file.")
              }
              try store.save(JSONDecoder().decode(Connection.self, from: data))
              saved()
              dismiss()
            } catch { self.error = error.localizedDescription }
          }
      }
    }
  }
#endif
