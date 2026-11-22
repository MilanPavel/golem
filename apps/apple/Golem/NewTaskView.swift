import GolemKit
import SwiftUI

/// New task: a recent folder, the text (the keyboard's microphone dictates), and Start.
struct NewTaskView: View {
    @State private var task: NewTaskModel
    let onStart: (String) -> Void
    let onCancel: () -> Void

    init(task: NewTaskModel, onStart: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        _task = State(initialValue: task)
        self.onStart = onStart
        self.onCancel = onCancel
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Folder") {
                    if task.folders.isEmpty {
                        Text("Your Mac's default folder").foregroundStyle(.secondary)
                    } else {
                        Picker("Folder", selection: $task.folder) {
                            ForEach(task.folders, id: \.self) { folder in
                                Text(folder).tag(Optional(folder))
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                        .accessibilityIdentifier("newtask.folder")
                    }
                }
                Section {
                    LabeledContent("Model", value: "Default")
                }
                Section {
                    TextField("What should golem do?", text: $task.text, axis: .vertical)
                        .lineLimit(4...10)
                        .accessibilityIdentifier("newtask.text")
                } footer: {
                    if let error = task.error {
                        Text(error).foregroundStyle(.red).accessibilityIdentifier("newtask.error")
                    }
                }
            }
            .navigationTitle("New task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel).accessibilityIdentifier("newtask.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") {
                        Task {
                            if let id = await task.start() { onStart(id) }
                        }
                    }
                    .disabled(!task.canStart)
                    .accessibilityIdentifier("newtask.start")
                }
            }
        }
        .interactiveDismissDisabled(task.isStarting)
    }
}
