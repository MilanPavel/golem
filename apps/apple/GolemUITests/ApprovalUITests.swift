import CryptoKit
import XCTest

/// The approval sheet on fixtures (debug menu), with a fake Mac and Face ID that passes.
final class ApprovalUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func b64(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// Pairs with the fake Mac and lands on the session list.
    private func launchPaired(extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiTestFakePairing"] + extra
        app.launch()
        let signing = P256.Signing.PrivateKey().publicKey.compressedRepresentation
        let noise = Curve25519.KeyAgreement.PrivateKey().publicKey.rawRepresentation
        let code = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
        let link = "golem://pair?v=1&relay=wss://relay.example.com&mac=\(b64(signing + noise))&code=\(b64(code))"
            + "&exp=\(Int(Date().timeIntervalSince1970 + 300))&name=Studio%20Mac"
        XCTAssertTrue(app.buttons["pair.paste"].waitForExistence(timeout: 10))
        app.buttons["pair.paste"].tap()
        let field = app.textFields["pair.link"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(link)
        app.buttons["pair.submit"].tap()
        XCTAssertTrue(app.buttons["pair.continue"].waitForExistence(timeout: 15))
        app.buttons["pair.continue"].tap()
        XCTAssertTrue(app.tabBars.buttons["Chats"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Chats"].tap()
        XCTAssertTrue(app.buttons["debug.menu"].waitForExistence(timeout: 10))
        return app
    }

    private func open(_ id: String, in app: XCUIApplication) {
        app.buttons["debug.menu"].tap()
        app.buttons["debug.approval.\(id)"].tap()
        XCTAssertTrue(app.staticTexts["approval.title"].waitForExistence(timeout: 5))
    }

    func testAShellCommandShowsItsFactsAndAsksForFaceIDToAllow() {
        let app = launchPaired()
        open("shell", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["approval.detail"].exists)
        XCTAssertTrue(app.staticTexts["approval.folder"].exists)
        XCTAssertTrue(app.staticTexts["approval.risky"].exists)
        XCTAssertTrue(app.buttons["approval.allow"].exists)
        XCTAssertTrue(app.buttons["approval.always"].exists)
        XCTAssertTrue(app.buttons["approval.deny"].exists)
        let rule = app.staticTexts["approval.rule"]
        XCTAssertTrue(rule.exists)
        XCTAssertTrue(rule.label.contains("marked from iPhone 16"))
        XCTAssertTrue(rule.label.contains("shell(git push"))
    }

    func testAlwaysAllowSavesAndClosesTheSheet() {
        let app = launchPaired()
        open("edit", in: app)
        XCTAssertFalse(app.staticTexts["approval.risky"].exists)
        app.buttons["approval.always"].tap()
        XCTAssertTrue(app.staticTexts["approval.closing"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["approval.closing"].label, "Always allowed")
        // The sheet closes by itself a moment after it says so.
        let title = app.staticTexts["approval.title"]
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: title)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 10), .completed)
    }

    func testDenyClosesTheSheet() {
        let app = launchPaired()
        open("mcp", in: app)
        app.buttons["approval.deny"].tap()
        XCTAssertEqual(app.staticTexts["approval.closing"].label, "Denied")
    }

    func testAnAnswerFromTheMacClosesTheSheetWithThatMessage() {
        let app = launchPaired()
        open("elsewhere", in: app)
        let closing = app.staticTexts["approval.closing"]
        XCTAssertTrue(closing.waitForExistence(timeout: 8))
        XCTAssertEqual(closing.label, "Answered on the Mac")
    }

    func testTheReviewCardIsHiddenWithoutItsFlag() {
        let app = launchPaired()
        app.buttons["debug.menu"].tap()
        XCTAssertTrue(app.buttons["debug.approval.shell"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["debug.review"].exists)
    }

    func testRejectingAReviewAsksForAReason() {
        let app = launchPaired(extra: ["-uiTestReview"])
        app.buttons["debug.menu"].tap()
        app.buttons["debug.review"].tap()
        XCTAssertTrue(app.textViews["review.draft"].waitForExistence(timeout: 5))
        app.buttons["review.reject"].tap()
        XCTAssertTrue(app.textFields["review.reason"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["review.approve"].exists)
    }
}
