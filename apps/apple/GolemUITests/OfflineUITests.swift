import XCTest

/// The Inbox while the Mac cannot be reached (`-uiTestScenario asleep` and `offline`): no relay, no network.
final class OfflineUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiTestFakePairing", "-uiTestScenario", scenario]
        app.launch()
        return app
    }

    func testAnAsleepMacShowsTheBannerAndKeepsTheInboxAsStale() {
        let app = launch("asleep")
        XCTAssertTrue(app.staticTexts["Needs you (2)"].waitForExistence(timeout: 10))
        let banner = app.descendants(matching: .any)["connection.banner"]
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertTrue(banner.label.contains("Can't reach your Mac"))
        XCTAssertTrue(banner.label.contains("Your Mac is asleep or offline. Answers will be sent when it is back."))
        // What was read stays, marked as last known.
        XCTAssertTrue(app.staticTexts["Needs you (2)"].exists)
        let stale = app.staticTexts["inbox.stale"]
        XCTAssertTrue(stale.waitForExistence(timeout: 5))
        XCTAssertTrue(stale.label.contains("Updated"))
    }

    func testNoNetworkHasItsOwnBanner() {
        let app = launch("offline")
        let banner = app.descendants(matching: .any)["connection.banner"]
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertTrue(banner.label.contains("No network"))
        XCTAssertEqual(app.staticTexts["connection.state"].label, "No network")
    }

    func testAnAnswerGivenWhileAwayWaitsToBeSent() {
        let app = launch("asleep")
        XCTAssertTrue(app.descendants(matching: .any)["connection.banner"].waitForExistence(timeout: 10))
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'uv lock --upgrade'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(app.buttons["approval.deny"].waitForExistence(timeout: 10))
        app.buttons["approval.deny"].tap()
        XCTAssertTrue(app.staticTexts["approval.closing"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["approval.closing"].label, "Waiting to send")
        // The sheet closes on its own and the row says what is waiting.
        let waiting = app.staticTexts["inbox.answer.call-s2"]
        XCTAssertTrue(waiting.waitForExistence(timeout: 10))
        XCTAssertTrue(waiting.label.contains("Waiting to send"))
        XCTAssertTrue(app.descendants(matching: .any)["connection.banner"].label.contains("1 answer waits."))
    }
}
