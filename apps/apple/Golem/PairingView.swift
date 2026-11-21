import SwiftUI

/// The first screen (mock: "Pair with your Mac"): the camera, and how to get a code.
struct PairingView: View {
    let model: AppModel
    let message: String?

    #if DEBUG
    @State private var pasting = false
    @State private var pasted = ""
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Pair with your Mac")
                .font(.largeTitle.bold())
            Text("Once. After that the phone finds the Mac anywhere.")
                .foregroundStyle(.secondary)

            ScannerView { model.handle(linkText: $0) }
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 22))
                .padding(.top, 8)

            if let message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("pair.error")
            }

            Text("On your Mac, run `golem devices pair`, or open Settings › Devices › Pair an iPhone in the web app. Point the camera at the code.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)

            Spacer(minLength: 0)

            #if DEBUG
            // The Simulator has no camera. Not in a release build.
            Button("Paste pair link") { pasting = true }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("pair.paste")
            #endif
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        #if DEBUG
        .sheet(isPresented: $pasting) {
            PasteLinkSheet(text: $pasted) {
                pasting = false
                model.handle(linkText: pasted)
                pasted = ""
            }
        }
        #endif
    }
}

#if DEBUG
private struct PasteLinkSheet: View {
    @Binding var text: String
    let submit: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("golem://pair link") {
                    TextField("golem://pair?v=1&…", text: $text, axis: .vertical)
                        .lineLimit(4...8)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("pair.link")
                    PasteButton(payloadType: String.self) { strings in
                        if let first = strings.first { text = first }
                    }
                }
                Section {
                    Button("Pair", action: submit)
                        .disabled(text.isEmpty)
                        .accessibilityIdentifier("pair.submit")
                }
            }
            .navigationTitle("Paste pair link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Cancel") { dismiss() } }
        }
    }
}
#endif

/// Used while the relay and the Mac are being reached.
struct WaitingView: View {
    let title: String
    let detail: String
    let model: AppModel

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
                .controlSize(.large)
            Text(title).font(.title2.bold())
            Text(detail).foregroundStyle(.secondary)
            Spacer()
            Button("Cancel") { model.cancelPairing() }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("pair.cancel")
        }
        .padding(20)
        .accessibilityIdentifier("pair.connecting")
    }
}

/// The three words, large. The same words are on the Mac's screen, and the owner confirms there.
struct ConfirmView: View {
    let words: [String]
    let model: AppModel

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("Check these words")
                .font(.title2.bold())
            Text(words.joined(separator: " · "))
                .font(.system(size: 34, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.5)
                .padding(.vertical, 20)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
                .accessibilityIdentifier("pair.words")
            Text("Confirm on your Mac")
                .font(.title3)
                .accessibilityIdentifier("pair.confirmOnMac")
            Text("Only if your Mac shows the same words.")
                .foregroundStyle(.secondary)
            ProgressView()
                .padding(.top, 8)
            Spacer()
            Button("Cancel") { model.cancelPairing() }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("pair.cancel")
        }
        .padding(20)
    }
}

struct PairedView: View {
    let macName: String
    let model: AppModel

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundStyle(.green)
            Text("Paired with \(macName)")
                .font(.title.bold())
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("pair.done")
            Spacer()
            Button {
                model.continueToSessions()
            } label: {
                Text("Continue").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("pair.continue")
        }
        .padding(20)
    }
}
