import XCTest

/// The session view, the result, the reply and the new task, with a fake Mac that keeps session logs.
final class SessionUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiTestFakePairing", "-uiTestScenario", scenario]
        app.launch()
        return app
    }

    private func openChat(_ app: XCUIApplication, _ id: String) {
        XCTAssertTrue(app.tabBars.buttons["Chats"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Chats"].tap()
        let row = app.buttons["chats.row.\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
    }

    private func message(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.staticTexts["session.msg.\(id)"]
    }

    func testALongTranscriptOpensAtTheEndAndKeepsItsPlaceWhenAMessageArrives() {
        let app = launch("empty")
        openChat(app, "s1")
        XCTAssertTrue(message(app, "a40").waitForExistence(timeout: 10), "the newest answer is on screen")
        XCTAssertFalse(app.buttons["session.latest"].exists)

        let transcript = app.scrollViews["session.transcript"]
        for _ in 0..<4 { transcript.swipeDown() }
        XCTAssertTrue(app.buttons["session.latest"].waitForExistence(timeout: 5), "scrolled away from the end")
        let anyMessage = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH 'session.msg.'")).element(boundBy: 0)
        XCTAssertTrue(anyMessage.exists)
        let id = anyMessage.identifier
        let top = anyMessage.frame.minY

        // The fake Mac sends a new message six seconds after the session opens.
        sleep(8)
        XCTAssertFalse(message(app, "late").exists, "the new message is below, not scrolled into view")
        let same = app.staticTexts[id]
        XCTAssertTrue(same.exists)
        XCTAssertEqual(same.frame.minY, top, accuracy: 2, "the place did not move")

        app.buttons["session.latest"].tap()
        XCTAssertTrue(message(app, "late").waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["session.latest"].waitForExistence(timeout: 1))
    }

    func testAtTheEndANewMessageScrollsIntoView() {
        let app = launch("empty")
        openChat(app, "s1")
        XCTAssertTrue(message(app, "a40").waitForExistence(timeout: 10))
        XCTAssertTrue(message(app, "late").waitForExistence(timeout: 12))
    }

    func testToolStepsAndTodosShowAndAReplyAppears() {
        let app = launch("empty")
        openChat(app, "s2")
        XCTAssertTrue(message(app, "m1").waitForExistence(timeout: 10))
        let tool = app.descendants(matching: .any)["session.tool.t1"]
        XCTAssertTrue(tool.exists)
        XCTAssertTrue(tool.label.contains("failed"), tool.label)
        XCTAssertTrue(app.descendants(matching: .any)["session.todos"].exists)

        let composer = app.textFields["session.composer"]
        composer.tap()
        composer.typeText("thanks")
        app.buttons["session.send"].tap()
        XCTAssertTrue(app.staticTexts["Got it: thanks"].waitForExistence(timeout: 10))
        XCTAssertEqual(composer.value as? String, "Reply\u{2026}", "the composer is empty again")
    }

    func testARoutineRunShowsItsBannerAndItsResultReadsFullScreen() {
        let app = launch("activity")
        let row = app.buttons["inbox.today.run2"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        let banner = app.staticTexts["session.banner"]
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertTrue(banner.label.hasPrefix("Routine morning-brief \u{b7} started"), banner.label)
        XCTAssertTrue(banner.label.contains("by schedule"), banner.label)
        let result = app.buttons["session.result"]
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        result.tap()
        let text = app.staticTexts["result.text"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        XCTAssertTrue(text.label.contains("PRs: 6 open"), text.label)
        app.buttons["result.done"].tap()
        XCTAssertTrue(app.staticTexts["session.banner"].waitForExistence(timeout: 5))
    }

    func testARunningTurnCanBeCancelled() {
        let app = launch("activity")
        let row = app.buttons["inbox.running.run1"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(app.descendants(matching: .any)["session.working"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["session.result"].exists)
        app.buttons["session.cancel"].tap()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.descendants(matching: .any)["session.working"])
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.buttons["session.cancel"].exists)
    }

    func testANewTaskOpensItsSession() {
        let app = launch("empty")
        XCTAssertTrue(app.tabBars.buttons["Chats"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Chats"].tap()
        let new = app.buttons["chats.new"]
        XCTAssertTrue(new.waitForExistence(timeout: 10))
        new.tap()
        XCTAssertTrue(app.navigationBars["New task"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["newtask.start"].isEnabled, "nothing typed yet")
        let text = app.textFields["newtask.text"]
        text.tap()
        text.typeText("Fix the flaky checkout test")
        app.buttons["newtask.start"].tap()
        XCTAssertTrue(app.staticTexts["Got it: Fix the flaky checkout test"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["session.composer"].exists)
    }
}
