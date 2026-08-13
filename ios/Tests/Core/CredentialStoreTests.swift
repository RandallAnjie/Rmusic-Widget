import XCTest
@testable import RMusic

final class CredentialStoreTests: XCTestCase {
    func testInMemoryCredentialLifecycle() throws {
        let store = InMemoryBearerTokenStore()
        XCTAssertNil(try store.readToken())
        try store.saveToken("rmu_example")
        XCTAssertEqual(try store.readToken(), "rmu_example")
        try store.deleteToken()
        XCTAssertNil(try store.readToken())
    }

    func testInMemoryCredentialRejectsWrongScheme() {
        let store = InMemoryBearerTokenStore()
        XCTAssertThrowsError(try store.saveToken("not-a-native-token")) { error in
            XCTAssertEqual(error as? CredentialStoreError, .invalidData)
        }
    }

    func testBase64URLRoundTrip() {
        let original = Data([0xfb, 0xef, 0xff, 0, 1, 2])
        let encoded = original.base64URLEncodedString()
        XCTAssertFalse(encoded.contains("+"))
        XCTAssertFalse(encoded.contains("/"))
        XCTAssertFalse(encoded.contains("="))
        XCTAssertEqual(Data(base64URLEncoded: encoded), original)
    }
}
