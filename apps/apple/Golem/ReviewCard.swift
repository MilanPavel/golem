import GolemKit
import SwiftUI

/// The review card (14.5.3): a workflow's draft in an editable text view, Approve, Edit and approve, and
/// Reject with a reason. Hidden until the protocol has review events (`ReviewFeature`).
struct ReviewCard: View {
    @Bindable var model: ReviewModel
    let onClose: () -> Void
    @FocusState private var editing: Bool
    @State private var rejecting = false
    @State private var reason = ""

    private var isDone: Bool {
        if case .done = model.phase { return true }
        return false
    }

    var body: some View {
        let request = model.request
        VStack(alignment: .leading, spacing: 10) {
            Text("\(request.workflow) \u{b7} run \(request.runId) \u{b7} step \(request.step)")
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            Text(request.title).font(.title3.bold())
            TextEditor(text: $model.draft)
                .focused($editing)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityIdentifier("review.draft")
            if let next = request.next {
                Text(next).font(.footnote).foregroundStyle(.secondary)
            }
            if rejecting {
                TextField("Why? This goes back to the workflow.", text: $reason, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("review.reason")
                Button("Send rejection", role: .destructive) {
                    Task { await model.reject(reason: reason) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("review.reject.send")
            } else {
                Button {
                    Task { await model.approve() }
                } label: {
                    Text(model.isEdited ? "Edit and approve" : "Approve").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("review.approve")
                Button {
                    editing = true
                } label: {
                    Text("Edit, then approve").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("review.edit")
                Button(role: .destructive) {
                    rejecting = true
                } label: {
                    Text("Reject\u{2026}").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("review.reject")
            }
            switch model.phase {
            case .failed(let message): Text(message).font(.caption).foregroundStyle(.red)
            case .done: Text("Sent").font(.headline).accessibilityIdentifier("review.done")
            default: EmptyView()
            }
        }
        .padding()
        .disabled(model.isBusy)
        .task(id: isDone) {
            guard isDone else { return }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if !Task.isCancelled { onClose() }
        }
    }
}
