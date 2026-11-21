import GolemKit
import SwiftUI

/// The approval sheet (14.5.3): the tool, the command or the diff, the folder, who asks, and the three
/// answers. Always allow, and Allow once on a risky tool, ask for Face ID first.
struct ApprovalSheet: View {
    let model: ApprovalSheetModel
    let onClose: () -> Void

    var body: some View {
        let request = model.request
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(request.helper.map { "\(request.origin) \u{b7} \($0)" } ?? request.origin)
                        .font(.caption.weight(.semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("approval.origin")
                    Text(title(request))
                        .font(.title3.bold())
                        .accessibilityIdentifier("approval.title")
                    if !request.detail.isEmpty {
                        ScrollView([.horizontal, .vertical]) {
                            Text(request.detail)
                                .font(.system(.footnote, design: .monospaced))
                                .textSelection(.enabled)
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 220)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                        .accessibilityIdentifier("approval.detail")
                    }
                    if let folder = request.folder {
                        Label(folder, systemImage: "folder")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("approval.folder")
                    }
                    if model.onceNeedsProof {
                        Label("Needs Face ID to allow", systemImage: "faceid")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("approval.risky")
                    }
                }
                .padding(.horizontal)
                .padding(.top, 20)
            }
            Divider()
            footer
                .padding()
        }
        .overlay { closing }
        .task {
            model.follow()
        }
        .onDisappear { model.stopFollowing() }
        .task(id: model.isClosing) {
            guard model.isClosing else { return }
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            if !Task.isCancelled { onClose() }
        }
        .interactiveDismissDisabled(model.isBusy)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("approval.sheet")
    }

    private func title(_ request: ApprovalRequest) -> String {
        "Use \(displayToolName(request.name))?"
    }

    @ViewBuilder private var footer: some View {
        VStack(spacing: 8) {
            if model.showsAllowOnce {
                Button {
                    Task { await model.allowOnce() }
                } label: {
                    Label("Allow once", systemImage: model.onceNeedsProof ? "faceid" : "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("approval.allow")
            }
            if model.showsAlwaysAllow {
                Button {
                    Task { await model.alwaysAllow() }
                } label: {
                    Label("Always allow this tool", systemImage: "faceid")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("approval.always")
            }
            Button(role: .destructive) {
                Task { await model.deny() }
            } label: {
                Text("Deny").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("approval.deny")
            if model.showsAlwaysAllow {
                Text(model.ruleNote)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("approval.rule")
            } else if !model.canProve {
                Text("This phone has no Face ID or passcode, so it cannot save a rule or allow this tool.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("approval.noproof")
            }
            if let note = model.confirmNote {
                Text(note).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("approval.note")
            }
            if case .failed(let message) = model.phase {
                Text(message).font(.caption).foregroundStyle(.red).accessibilityIdentifier("approval.error")
            }
        }
        .disabled(model.isBusy)
    }

    @ViewBuilder private var closing: some View {
        if let text = model.closingText {
            VStack(spacing: 8) {
                Image(systemName: model.phase == .answeredElsewhere ? "desktopcomputer" : "checkmark.circle")
                    .font(.largeTitle)
                Text(text).font(.headline).accessibilityIdentifier("approval.closing")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.regularMaterial)
            .transition(.opacity)
        }
    }
}

extension View {
    /// Shows the sheet for `AppModel.presentedApproval`, and closes it when it is answered.
    func approvalSheet(_ app: AppModel) -> some View {
        sheet(
            isPresented: Binding(
                get: { app.presentedApproval != nil },
                set: { if !$0 { app.dismissApproval() } })
        ) {
            if let sheet = app.presentedApproval {
                ApprovalSheet(model: sheet, onClose: { app.dismissApproval() })
                    .presentationDetents([.medium, .large])
            }
        }
    }
}
