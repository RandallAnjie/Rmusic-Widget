import XCTest
@testable import RMusic

final class DeepLinkTests: XCTestCase {
    func testWebSearchDeepLink() {
        let link = RMusicDeepLinkParser.parse(
            URL(string: "https://music.bigrandall.io/?q=Lemon&server=netease")!
        )
        XCTAssertEqual(link, .search(query: "Lemon", source: .netease))
    }

    func testCustomPlaylistDeepLink() {
        let link = RMusicDeepLinkParser.parse(
            URL(string: "rmusic://playlist?id=9505357778&server=tencent")!
        )
        XCTAssertEqual(link, .playlist(source: .tencent, id: "9505357778"))
    }

    func testRejectsForeignWebHost() {
        XCTAssertNil(RMusicDeepLinkParser.parse(URL(string: "https://example.com/?q=Lemon")!))
    }

    func testPlaylistShareLinkRecognition() {
        XCTAssertEqual(
            PlaylistReferenceParser.parse("https://music.163.com/playlist?id=123"),
            PlaylistReference(source: .netease, id: "123")
        )
        XCTAssertEqual(
            PlaylistReferenceParser.parse("https://open.spotify.com/playlist/37i9dQZF1DX"),
            PlaylistReference(source: .spotify, id: "37i9dQZF1DX")
        )
    }
}
