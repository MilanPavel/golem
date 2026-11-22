import GolemKit
import SwiftUI

/// Where a Chats row, a Running row or a Today row goes: one session, which a routine's run is too.
struct SessionRoute: Hashable {
    let sessionID: String
    /// The name until the session list has a title for it.
    let title: String
}

extension View {
    /// Opens `SessionRoute` values in this navigation stack.
    func sessionDestination(_ model: AppModel) -> some View {
        navigationDestination(for: SessionRoute.self) { SessionScreen(model: model, route: $0) }
    }
}

/// The transcript of a session or run, the composer, and the full-screen result.
struct SessionScreen: View {
    let model: AppModel
    let route: SessionRoute
    @State private var detail: SessionDetailModel?
    @State private var showResult = false

    init(model: AppModel, route: SessionRoute) {
        self.model = model
        self.route = route
        _detail = State(initialValue: model.sessionDetail(sessionID: route.sessionID, title: route.title))
    }

    private var title: String {
        model.sessions.sessions.first { $0.sessionId == route.sessionID }?.title ?? route.title
    }

    var body: some View {
        Group {
            if let detail {
                content(detail)
            } else {
                ContentUnavailableView("Your Mac is not connected", systemImage: "wifi.slash")
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ detail: SessionDetailModel) -> some View {
        VStack(spacing: 0) {
            if let run = model.runs.runs.first(where: { $0.sessionId == route.sessionID }) {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text(runBannerText(run, now: nowMilliseconds(context.date)))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .background(.bar)
                        .accessibilityIdentifier("session.banner")
                }
            }
            TranscriptList(detail: detail)
            Composer(detail: detail)
        }
        .task { await detail.run() }
        .toolbar {
            if detail.result != nil, !detail.chat.busy {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Result", systemImage: "doc.text") { showResult = true }
                        .accessibilityIdentifier("session.result")
                }
            }
        }
        .fullScreenCover(isPresented: $showResult) {
            if let message = detail.result {
                ResultView(title: title, message: message) { showResult = false }
            }
        }
    }
}

// MARK: - The transcript

private struct TranscriptList: View {
    let detail: SessionDetailModel
    /// Whether the end of the transcript is on screen. New content scrolls into view only then.
    @State private var atBottom = true
    @State private var lastGrowth = Date.distantPast
    private let bottomID = "bottom"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(detail.transcript.turns, id: \.id) { turn in
                        TurnView(turn: turn)
                    }
                    Status(detail: detail)
                    TodosView(todos: detail.chat.todos)
                    Color.clear.frame(height: 1)
                        .id(bottomID)
                        .onAppear { setAtBottom(true) }
                        .onDisappear { setAtBottom(false) }
                }
                .padding()
            }
            .defaultScrollAnchor(.bottom)
            .accessibilityIdentifier("session.transcript")
            .onChange(of: detail.growth) {
                // The sentinel leaves the screen because content grew, not because the person scrolled,
                // so a change in the next moment does not count as theirs.
                lastGrowth = Date()
                if atBottom { proxy.scrollTo(bottomID, anchor: .bottom) }
            }
            .overlay(alignment: .bottomTrailing) {
                if !atBottom {
                    Button {
                        atBottom = true
                        withAnimation { proxy.scrollTo(bottomID, anchor: .bottom) }
                    } label: {
                        Image(systemName: "arrow.down.circle.fill").font(.title).padding()
                    }
                    .accessibilityLabel("Jump to the latest")
                    .accessibilityIdentifier("session.latest")
                }
            }
            .overlay {
                switch detail.load {
                case .loading where detail.chat.messages.isEmpty: ProgressView()
                case .failed(let message): ContentUnavailableView(message, systemImage: "exclamationmark.triangle")
                default: EmptyView()
                }
            }
        }
    }

    private func setAtBottom(_ value: Bool) {
        guard Date().timeIntervalSince(lastGrowth) > 0.3 else { return }
        atBottom = value
    }
}

private struct TurnView: View {
    let turn: Turn

    var body: some View {
        switch turn {
        case .user(_, let message):
            Text(markdownText(message.text))
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 14))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.leading, 40)
                .accessibilityIdentifier("session.msg.\(message.id)")
        case .golem(_, let steps):
            VStack(alignment: .leading, spacing: 8) {
                ForEach(steps) { step in
                    StepView(message: step)
                }
            }
        }
    }
}

private struct StepView: View {
    let message: ChatMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let thinking = thinkingLine(message) {
                Text(thinking).font(.caption).foregroundStyle(.secondary)
            }
            if !message.text.isEmpty {
                Text(markdownText(message.text))
                    .textSelection(.enabled)
                    .accessibilityIdentifier("session.msg.\(message.id)")
            }
            ForEach(message.tools ?? []) { tool in
                ToolRow(tool: tool)
            }
            if message.interrupted == true {
                Text("stopped before it finished").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One tool step as a line: its mark, its name, and how it went.
private struct ToolRow: View {
    let tool: ToolBlock

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(displayToolName(tool.name)).font(.system(.footnote, design: .monospaced))
            Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(displayToolName(tool.name)), \(markWords), \(detail)")
        .accessibilityIdentifier("session.tool.\(tool.callId)")
    }

    private var color: Color {
        switch stepMark(tool) {
        case .allow: .green
        case .deny: .red
        case .wait: .orange
        case .run: .gray
        }
    }

    private var markWords: String {
        switch stepMark(tool) {
        case .allow: "done"
        case .deny: "failed"
        case .wait: "waiting for you"
        case .run: "running"
        }
    }

    private var detail: String {
        tool.error ?? tool.summary ?? (stepMark(tool) == .wait ? "waiting for you" : tool.status.rawValue)
    }
}

/// What golem is doing now, and a failure or notice of the last run.
private struct Status: View {
    let detail: SessionDetailModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let phase = detail.chat.phase {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(phase == .waiting ? "Waiting for your answer" : "Working\u{2026}")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("session.working")
            }
            if let error = detail.chat.error {
                Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("session.error")
            }
            if let notice = detail.chat.notice {
                Text(notice).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

private struct TodosView: View {
    let todos: [TodoItem]

    var body: some View {
        if !todos.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(todoSummary(todos)).font(.footnote.weight(.semibold))
                ForEach(todos) { todo in
                    Label(todo.text, systemImage: todo.status == .done ? "checkmark.circle.fill" : todo.status == .inProgress ? "circle.dotted" : "circle")
                        .font(.footnote)
                        .foregroundStyle(todo.status == .done ? .secondary : .primary)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("session.todos")
        }
    }
}

// MARK: - The composer

/// The reply field. The keyboard's microphone dictates into it.
private struct Composer: View {
    @Bindable var detail: SessionDetailModel

    var body: some View {
        VStack(spacing: 0) {
            if let error = detail.actionError {
                Text(error).font(.footnote).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal).padding(.top, 6)
                    .accessibilityIdentifier("session.actionError")
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Reply\u{2026}", text: $detail.draft, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("session.composer")
                if detail.chat.busy, detail.chat.runId != nil {
                    Button {
                        Task { await detail.cancelRun() }
                    } label: {
                        Image(systemName: "stop.circle.fill").font(.title)
                    }
                    .accessibilityLabel("Stop")
                    .accessibilityIdentifier("session.cancel")
                }
                Button {
                    Task { await detail.send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title)
                }
                .disabled(!detail.canSend)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("session.send")
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(.bar)
    }
}

// MARK: - The result

/// A finished run's last message, full screen and large, for reading.
private struct ResultView: View {
    let title: String
    let message: ChatMessage
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(markdownText(message.text))
                    .font(.title3)
                    .lineSpacing(4)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .accessibilityIdentifier("result.text")
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", action: onClose).accessibilityIdentifier("result.done")
                }
            }
        }
    }
}
