import XCTest
@testable import RMusic

final class NowPlayingSnapshotTests: XCTestCase {
    func testSnapshotRoundTripsAcrossWidgetJSONContract() throws {
        let capturedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let snapshot = NowPlayingSnapshot(
            trackID: "netease:42",
            source: "netease",
            title: "Night Drive",
            artist: "Randall",
            album: "After Dark",
            artworkURL: URL(string: "https://music.bigrandall.io/cover.jpg"),
            currentTime: 82.5,
            duration: 240,
            isPlaying: true,
            isBuffering: false,
            capturedAt: capturedAt
        )

        let data = try JSONEncoder().encode(snapshot)
        let decoded = try JSONDecoder().decode(NowPlayingSnapshot.self, from: data)

        XCTAssertEqual(decoded, snapshot)
    }

    func testSnapshotStillDecodesBeforeBufferingFlagWasAdded() throws {
        let legacy = """
        {
          "trackID":"netease:42",
          "source":"netease",
          "title":"Night Drive",
          "artist":"Randall",
          "currentTime":12,
          "duration":240,
          "isPlaying":true,
          "capturedAt":0
        }
        """

        let decoded = try JSONDecoder().decode(
            NowPlayingSnapshot.self,
            from: Data(legacy.utf8)
        )

        XCTAssertNil(decoded.isBuffering)
        XCTAssertEqual(decoded.title, "Night Drive")
    }
}
