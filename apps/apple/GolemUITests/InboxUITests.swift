import XCTest

/// The Inbox with a fake Mac in each state (`-uiTestScenario`): no relay, no network.
final class InboxUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiTestFakePairing", "-uiTestScenario", scenario]
        app.launch()
        return app
    }

    func testTheTabsAreInboxAutomationsChatsAndTheInboxIsFirst() {
        let app = launch("empty")
        XCTAssertTrue(app.tabBars.buttons["Inbox"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.tabBars.buttons.allElementsBoundByIndex.map(\.label), ["Inbox", "Automations", "Chats"])
        XCTAssertTrue(app.tabBars.buttons["Inbox"].isSelected)
        app.tabBars.buttons["Automations"].tap()
        XCTAssertTrue(app.otherElements["automations.empty"].waitForExistence(timeout: 5)
            || app.staticTexts["No automations yet"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Chats"].tap()
        XCTAssertTrue(app.staticTexts["Fix the flaky test"].waitForExistence(timeout: 5))
    }

    func testNothingNeedsYouWhenNothingWaits() {
        let app = launch("empty")
        XCTAssertTrue(app.staticTexts["Nothing needs you."].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["connection.state"].label, "Connected to Studio Mac")
    }

    func testTwoItemsNeedYouAndATapOpensTheSheet() {
        let app = launch("needs")
        XCTAssertTrue(app.staticTexts["Needs you (2)"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Nothing needs you."].exists)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'rm -rf build'")).firstMatch.exists)
        let second = app.buttons.matching(NSPredicate(format: "label CONTAINS 'uv lock --upgrade'")).firstMatch
        XCTAssertTrue(second.exists)
        second.tap()
        XCTAssertTrue(app.staticTexts["Upgrade httpx"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.otherElements["approval.placeholder"].exists || app.staticTexts["Run `uv lock --upgrade`"].exists)
    }

    func testRunningAndTodayShowTheRuns() {
        let app = launch("activity")
        XCTAssertTrue(app.staticTexts["Running"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Today"].exists)
        XCTAssertTrue(app.staticTexts["pr-digest"].exists)
        XCTAssertTrue(app.staticTexts["morning-brief"].exists)
        XCTAssertTrue(app.staticTexts["Three PRs need a look."].exists)
        XCTAssertTrue(app.staticTexts["Nothing needs you."].exists)
    }

    func testWhenTheMacIsUnreachableTheHeaderSaysSo() {
        let app = launch("disconnected")
        let state = app.staticTexts["connection.state"]
        XCTAssertTrue(state.waitForExistence(timeout: 10))
        XCTAssertEqual(state.label, "Can't reach your Mac")
    }

    func testAnApprovalThatArrivesLaterAppearsWithoutARefresh() {
        let app = launch("live")
        XCTAssertTrue(app.staticTexts["Nothing needs you."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Needs you (1)"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["Nothing needs you."].exists)
    }
}
