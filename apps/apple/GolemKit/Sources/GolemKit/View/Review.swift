import Foundation
import Observation

// The review card: a workflow step that waits for the owner to approve its draft (Phase 3, `run.review`).
// The protocol has no review events yet, so this is built against a fixture and the app keeps it hidden.
// What the answers send is left to `ReviewResponder` until the wire exists.

/// A draft that waits for a review.
public struct ReviewRequest: Equatable, Identifiable, Sendable {
    public var runId: String
    /// The workflow, such as `pr-digest`.
    public var workflow: String
    public var step: String
    /// The question, such as "Post this digest to #eng?".
    public var title: String
    public var draft: String
    /// What happens after approval, as one line.
    public var next: String?

    public var id: String { "\(runId)/\(step)" }

    public init(runId: String, workflow: String, step: String, title: String, draft: String, next: String? = nil) {
        self.runId = runId
        self.workflow = workflow
        self.step = step
        self.title = title
        self.draft = draft
        self.next = next
    }

    /// A review for tests, UI tests and previews.
    public static let fixture = ReviewRequest(
        runId: "7f3a", workflow: "pr-digest", step: "review", title: "Post this digest to #eng?",
        draft: "PRs this week \u{b7} 12\n\u{2022} 4 ready to merge: checkout retry, \u{2026}\n"
            + "\u{2022} 3 need review: search index, \u{2026}\n\u{2022} 2 failing CI: flaky payment test\n\u{2022} 3 drafts",
        next: "Next: post_digest \u{2192} Slack #eng (once)"
    )
}

/// How the owner answered a review.
public enum ReviewAnswer: Equatable, Sendable {
    case approve
    /// Approve with the draft as the owner edited it.
    case approveEdited(String)
    /// Reject, with the reason that goes back to the workflow.
    case reject(reason: String)
}

public protocol ReviewResponder: Sendable {
    func answer(_ answer: ReviewAnswer, for review: ReviewRequest) async throws
}

/// Whether the app shows the review card. Off until the protocol has review events; a debug build turns it
/// on with `-uiTestReview`.
public enum ReviewFeature {
    public static func isEnabled(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        #if DEBUG
        return arguments.contains("-uiTestReview")
        #else
        return false
        #endif
    }
}

@MainActor @Observable
public final class ReviewModel {
    public enum Phase: Equatable {
        case ready
        case sending
        case done(ReviewAnswer)
        case failed(String)
    }

    public let request: ReviewRequest
    /// The draft as the owner has it in the text view.
    public var draft: String
    public private(set) var phase: Phase = .ready

    private let responder: any ReviewResponder

    public init(request: ReviewRequest, responder: any ReviewResponder) {
        self.request = request
        self.draft = request.draft
        self.responder = responder
    }

    public var isEdited: Bool { draft != request.draft }
    public var isBusy: Bool { phase == .sending }

    /// Approve, as the draft stands: edited text goes with "Edit and approve", so a plain Approve of an
    /// unchanged draft sends none.
    public func approve() async {
        await send(isEdited ? .approveEdited(draft) : .approve)
    }

    public func reject(reason: String) async {
        await send(.reject(reason: reason.trimmingCharacters(in: .whitespacesAndNewlines)))
    }

    private func send(_ answer: ReviewAnswer) async {
        guard !isBusy else { return }
        phase = .sending
        do {
            try await responder.answer(answer, for: request)
            phase = .done(answer)
        } catch {
            phase = .failed("The answer did not reach your Mac.")
        }
    }
}
