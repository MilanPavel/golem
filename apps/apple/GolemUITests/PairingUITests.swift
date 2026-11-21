import CryptoKit
import XCTest

/// The pairing screens with a fake connection (`-uiTestFakePairing`): no camera, relay or Mac.
final class PairingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiTestFakePairing"]
        app.launch()
        return app
    }

    /// A pair link that parses: a real compressed P-256 point, a Noise key, a code, a time ahead.
    private func pairLink(expires: TimeInterval) -> String {
        let signing = P256.Signing.PrivateKey().publicKey.compressedRepresentation
        let noise = Curve25519.KeyAgreement.PrivateKey().publicKey.rawRepresentation
        func b64(_ data: Data) -> String {
            data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        }
        let code = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
        return "golem://pair?v=1&relay=wss://relay.example.com&mac=\(b64(signing + noise))&code=\(b64(code))"
            + "&exp=\(Int(Date().timeIntervalSince1970 + expires))&name=Studio%20Mac"
    }

    private func paste(_ link: String, in app: XCUIApplication) {
        app.buttons["pair.paste"].tap()
        let field = app.textFields["pair.link"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(link)
        app.buttons["pair.submit"].tap()
    }

    func testPairingShowsTheWordsThenPairedThenTheSessions() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["Pair with your Mac"].waitForExistence(timeout: 10))
        paste(pairLink(expires: 300), in: app)

        let words = app.staticTexts["pair.words"]
        XCTAssertTrue(words.waitForExistence(timeout: 10))
        XCTAssertEqual(words.label, "kiln · otter · maple")
        XCTAssertTrue(app.staticTexts["Confirm on your Mac"].exists)

        let done = app.staticTexts["pair.done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10))
        XCTAssertEqual(done.label, "Paired with Studio Mac")

        app.buttons["pair.continue"].tap()
        XCTAssertTrue(app.staticTexts["Fix the flaky test"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Upgrade httpx"].exists)
    }

    func testAnExpiredCodeSaysSo() {
        let app = launch()
        XCTAssertTrue(app.buttons["pair.paste"].waitForExistence(timeout: 10))
        paste(pairLink(expires: -60), in: app)
        let error = app.staticTexts["pair.error"]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.label.contains("expired"))
    }

    func testSomethingElseIsNotAPairingCode() {
        let app = launch()
        XCTAssertTrue(app.buttons["pair.paste"].waitForExistence(timeout: 10))
        paste("https://example.com", in: app)
        XCTAssertTrue(app.staticTexts["pair.error"].waitForExistence(timeout: 5))
    }

    func testCancelGoesBackToTheScanner() {
        let app = launch()
        XCTAssertTrue(app.buttons["pair.paste"].waitForExistence(timeout: 10))
        paste(pairLink(expires: 300), in: app)
        XCTAssertTrue(app.buttons["pair.cancel"].waitForExistence(timeout: 10))
        app.buttons["pair.cancel"].tap()
        XCTAssertTrue(app.buttons["pair.paste"].waitForExistence(timeout: 5))
    }
}
