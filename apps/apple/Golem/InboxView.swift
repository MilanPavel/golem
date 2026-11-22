import GolemKit
import SwiftUI

/// The home screen: what waits on you, what runs, and what finished today.
struct InboxView: View {
    let model: AppModel

    var body: some View {
        NavigationStack {
            // Ages and elapsed times count up, so the screen redraws each second.
            TimelineView(.periodic(from: .now, by: 1)) { context in
                content(model.inbox(now: context.date), now: context.date)
            }
            .sessionDestination(model)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .principal) { ConnectionHeader(model: model) } }
            .refreshable { await model.refresh() }
        }
    }

    private func content(_ inbox: Inbox, now: Date) -> some View {
        let ms = nowMilliseconds(now)
        return List {
            if let stale = model.staleText {
                Text("Last known \u{b7} \(stale)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("inbox.stale")
            }
            Section {
                if inbox.needsYou.isEmpty {
                    Text("Nothing needs you.")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("inbox.empty")
                }
                ForEach(inbox.needsYou) { item in
                    NeedsYouRow(item: item, answer: model.pendingAnswer(for: item)) {
                        model.present(item: item)
                    }
                }
            } header: {
                Text(inbox.needsYou.isEmpty ? "Needs you" : "Needs you (\(inboxCount(inbox.needsYou)))")
            }
            if !inbox.running.isEmpty {
                Section("Running") {
                    ForEach(inbox.running) { run in
                        NavigationLink(value: SessionRoute(sessionID: run.sessionId, title: runName(run))) {
                            RunRow(run: run, detail: runRowLine(run, now: ms), trailing: runDuration(run, now: ms))
                        }
                        .accessibilityIdentifier("inbox.running.\(run.sessionId)")
                    }
                }
            }
            if !inbox.today.isEmpty {
                Section("Today") {
                    ForEach(inbox.today) { run in
                        NavigationLink(value: SessionRoute(sessionID: run.sessionId, title: runName(run))) {
                            RunRow(run: run, detail: runResultLine(run), trailing: runDuration(run, now: ms))
                        }
                        .accessibilityIdentifier("inbox.today.\(run.sessionId)")
                    }
                }
            }
        }
        .accessibilityIdentifier("inbox.list")
    }
}

private struct NeedsYouRow: View {
    let item: InboxItem
    let answer: PendingAnswer?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.headline).foregroundStyle(.primary)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                    if let answer {
                        Text(answer.rowText)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(answer.status == .waiting ? .orange : .secondary)
                            .accessibilityIdentifier("inbox.answer.\(item.callId ?? "")")
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("inbox.needs.\(item.id)")
    }

    private var detail: String {
        var parts = [item.sessionTitle]
        if let source = item.source, !source.isEmpty { parts.append(source) }
        if !item.age.isEmpty { parts.append(item.age == "now" ? "waiting now" : "waiting \(item.age)") }
        return parts.joined(separator: " \u{b7} ")
    }
}

private struct RunRow: View {
    let run: RunLike
    let detail: String
    let trailing: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(runName(run))
                if !detail.isEmpty {
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer()
            if !trailing.isEmpty {
                Text(trailing).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
