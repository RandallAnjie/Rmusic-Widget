import XCTest
@testable import RMusic

@MainActor
final class APIClientTests: XCTestCase {
    func testSearchURLConstruction() throws {
        let client = RMusicAPIClient(tokenStore: InMemoryBearerTokenStore())
        let url = try client.makeURL(path: "/api/proxy/v2/tracks", queryItems: [
            URLQueryItem(name: "query", value: "夜 曲"),
            URLQueryItem(name: "source", value: "netease")
        ])
        XCTAssertEqual(url.host, "music.bigrandall.io")
        XCTAssertTrue(url.absoluteString.contains("query=%E5%A4%9C%20%E6%9B%B2"))
        XCTAssertTrue(url.absoluteString.contains("source=netease"))
    }

    func testStreamURLUsesQualityAndEncodedID() {
        let client = RMusicAPIClient(tokenStore: InMemoryBearerTokenStore(token: "rmu_test"))
        let track = Track(id: "a/b c", source: .netease, title: "Test")

        let url = client.streamURL(for: track, quality: .lossless)

        XCTAssertEqual(url?.query, "quality=lossless")
        XCTAssertEqual(url?.pathComponents.suffix(2).first, "netease")
        XCTAssertEqual(url?.pathComponents.last, "a/b c")
    }

    func testAuthorizedRequestHasNativeHeaders() {
        let client = RMusicAPIClient(tokenStore: InMemoryBearerTokenStore(token: "rmu_test"))
        let request = client.authorizedRequest(for: URL(string: "https://music.bigrandall.io/api/proxy/v2/test")!)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer rmu_test")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-RMusic-Client"), "ios-v1")
    }

    func testAuthorizedRequestNeverLeaksBearerToExternalArtworkHost() {
        let client = RMusicAPIClient(tokenStore: InMemoryBearerTokenStore(token: "rmu_secret"))
        let request = client.authorizedRequest(for: URL(string: "https://images.example/cover.jpg")!)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "X-RMusic-Client"))
    }
}
