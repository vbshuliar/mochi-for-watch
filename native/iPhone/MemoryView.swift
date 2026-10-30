import MochiCore
import SwiftUI

struct MemoryView: View {
  let model: PhoneModel
  @State private var adding = false
  @State private var editing: SavedMemory?
  @State private var forgetAll = false
  @Environment(\.scenePhase) private var phase
  var body: some View {
    List {
      Section {
        if model.memories.isEmpty {
          Text("Say “remember I live in London” to Mochi, or add a memory here.").foregroundStyle(.secondary)
        }
        ForEach(model.memories) { memory in
          Button { editing = memory } label: {
            VStack(alignment: .leading, spacing: 4) {
              Text(memory.title).foregroundStyle(.primary)
              Text(memory.text).font(.subheadline).foregroundStyle(.secondary)
            }.padding(.vertical, 3)
          }
        }
      } footer: {
        Text("Shared with Mochi on your iPhone and Watch. Only facts you ask Mochi to remember are saved. Changes reset conversation context so old facts aren’t reused.")
      }
      if let error = model.memoryError { Section { Text(error).foregroundStyle(.red) } }
      if !model.memories.isEmpty {
        Section { Button("Forget everything", role: .destructive) { forgetAll = true }.disabled(model.memoryBusy) }
      }
    }
    .navigationTitle("Memory")
    .toolbar { Button("Add", systemImage: "plus") { adding = true }.disabled(model.memoryBusy) }
    .task { await model.loadMemories() }
    .refreshable { await model.loadMemories() }
    .onChange(of: phase) { _, value in if value == .active { Task { await model.loadMemories() } } }
    .sheet(isPresented: $adding) { MemoryEditor(model: model, memory: nil) }
    .sheet(item: $editing) { memory in MemoryEditor(model: model, memory: memory) }
    .confirmationDialog("Forget all saved memories?", isPresented: $forgetAll, titleVisibility: .visible) {
      Button("Forget everything", role: .destructive) { Task { _ = await model.forgetMemory(id: nil) } }
    } message: { Text("Mochi will stop using these facts. This cannot be undone.") }
  }
}
struct MemoryEditor: View {
  let model: PhoneModel
  let memory: SavedMemory?
  @State private var title: String
  @State private var text: String
  @State private var deleting = false
  @Environment(\.dismiss) private var dismiss
  init(model: PhoneModel, memory: SavedMemory?) {
    self.model = model; self.memory = memory
    _title = State(initialValue: memory?.title ?? "")
    _text = State(initialValue: memory?.text ?? "")
  }
  var body: some View {
    NavigationStack {
      Form {
        Section("About you") {
          TextField("Title", text: $title)
          TextField("What should Mochi remember?", text: $text, axis: .vertical).lineLimit(3...8)
        }
        if let error = model.memoryError { Section { Text(error).foregroundStyle(.red) } }
        if memory != nil {
          Section { Button("Delete memory", role: .destructive) { deleting = true }.disabled(model.memoryBusy) }
        }
      }
      .navigationTitle(memory == nil ? "New memory" : "Edit memory")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(model.memoryBusy) }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") {
            Task { if await model.saveMemory(id: memory?.id, title: title, text: text) { dismiss() } }
          }.disabled(model.memoryBusy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 80 || text.count > 500)
        }
      }
      .interactiveDismissDisabled(model.memoryBusy)
      .confirmationDialog("Delete this memory?", isPresented: $deleting, titleVisibility: .visible) {
        Button("Delete memory", role: .destructive) {
          Task { if await model.forgetMemory(id: memory?.id) { dismiss() } }
        }
      }
    }
  }
}
