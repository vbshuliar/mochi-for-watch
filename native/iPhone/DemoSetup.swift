  import SwiftUI
  import UniformTypeIdentifiers
  import MochiCore

  struct DemoSetup: View {
    let store: ConnectionStore
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var error: String?
    @State private var address = ""
    @State private var token = ""
    @State private var pairingCode = ""
    @State private var pairingModel: PairingModel
    @State private var pairingTask: Task<Void, Never>?
    init(store: ConnectionStore, saved: @escaping () -> Void) {
      self.store = store; self.saved = saved
      _pairingModel = State(initialValue: PairingModel(store: store))
    }
    private var pairing: Bool { pairingModel.busy }
    var body: some View {
      NavigationStack {
        Form {
          Section("Pair with your backend") {
            TextField("Backend HTTPS address", text: $address).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            SecureField("One-time pairing code", text: $pairingCode).textInputAutocapitalization(.characters).autocorrectionDisabled().privacySensitive()
            Text("Use a short-lived code from your private backend. Your connection is stored securely and shared with your paired Watch.").font(.footnote)
            Button("Pair iPhone and Watch") {
              error = nil
              pairingTask = Task {
                if await pairingModel.pair(address: address, code: pairingCode) {
                  pairingCode = ""; saved(); dismiss()
                }
              }
            }.disabled(pairing || pairingCode.isEmpty || address.isEmpty)
            if store.connection != nil { Button("Sync with Apple Watch") { saved() }.disabled(pairing) }
          }
          #if DEBUG
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
                else { throw MochiError.message("Enter a valid backend address.") }
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
          #endif
          if let error = pairingModel.error ?? error { Section { Text(error).foregroundStyle(.red) } }
        }.disabled(pairing).navigationTitle("Connection")
          .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(pairing) } }
          .interactiveDismissDisabled(pairing)
          .onDisappear { pairingTask?.cancel(); pairingModel.cancel() }
          .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            do {
              let url = try result.get()
              let access = url.startAccessingSecurityScopedResource()
              defer { if access { url.stopAccessingSecurityScopedResource() } }
              let data = try Data(contentsOf: url)
              guard data.count < 16384 else {
                throw MochiError.message("That isn’t a connection file.")
              }
              try store.save(JSONDecoder().decode(Connection.self, from: data))
              saved()
              dismiss()
            } catch { self.error = error.localizedDescription }
          }
      }
    }
  }
