import XCTest
@testable import RMusic

final class CoreModelsTests: XCTestCase {
    func testTrackDecodesV2AndResolvesRelativeLinks() throws {
        let data = Data(#"""
        {
          "id": 42,
          "source": "netease",
          "title": "Night Drive",
          "artists": [{"id":"artist-1","name":"RMusic"}],
          "album": {"id":"album-1","name":"City Lights"},
          "durationMs": 213000,
          "artwork": {"url":"/api/proxy/v2/artworks/netease/42"},
          "links": {
            "stream":"/api/proxy/v2/streams/netease/42",
            "lyrics":"/api/proxy/v2/lyrics/netease/42",
            "wordLyrics":"/api/proxy/v2/lyrics/netease/42?granularity=word"
          },
          "playback": {"available":true,"previewOnly":false,"qualities":[]}
        }
        """#.utf8)

        let track = try JSONDecoder().decode(Track.self, from: data)

        XCTAssertEqual(track.id, "42")
        XCTAssertEqual(track.stableID, "netease:42")
        XCTAssertEqual(track.artistsText, "RMusic")
        XCTAssertEqual(track.albumName, "City Lights")
        XCTAssertEqual(track.duration, 213)
        XCTAssertEqual(track.artworkURL?.absoluteString, "https://music.bigrandall.io/api/proxy/v2/artworks/netease/42")
        XCTAssertEqual(track.lyricsURL(wordLevel: true)?.query, "granularity=word")
    }

    func testTrackDecodesCloudSnapshotAliases() throws {
        let data = Data(#"""
        {
          "id":"legacy-1",
          "server":"tencent",
          "title":"旧收藏",
          "author":"歌手 A / 歌手 B",
          "album":"旧专辑",
          "url":"/api/proxy/v2/streams/tencent/legacy-1",
          "pic":"/api/proxy/v2/artworks/tencent/legacy-1",
          "lrc":"/api/proxy/v2/lyrics/tencent/legacy-1",
          "duration_ms":"180000"
        }
        """#.utf8)

        let track = try JSONDecoder().decode(Track.self, from: data)

        XCTAssertEqual(track.source, .tencent)
        XCTAssertEqual(track.artistsText, "歌手 A / 歌手 B")
        XCTAssertEqual(track.albumName, "旧专辑")
        XCTAssertEqual(track.durationMs, 180_000)
        XCTAssertNotNil(track.links.streamURL)
    }

    func testDiscoveryToleratesSnakeCaseNewReleases() throws {
        let data = Data(#"""
        {"recommendations":[],"charts":[],"new_releases":[{"id":"1","server":"kugou","title":"新歌"}]}
        """#.utf8)
        let discovery = try JSONDecoder().decode(DiscoveryPayload.self, from: data)
        XCTAssertEqual(discovery.newReleases.first?.source, .kugou)
    }

    func testPlaylistDatesDecodeMilliseconds() throws {
        let data = Data(#"""
        {"version":2,"server":"netease","id":"p1","name":"收藏","tracks":[],"cachedAt":1700000000000,"savedAt":1700000001000}
        """#.utf8)
        let playlist = try JSONDecoder().decode(PlaylistSnapshot.self, from: data)
        XCTAssertEqual(playlist.cachedAt.timeIntervalSince1970, 1_700_000_000, accuracy: 0.001)
        XCTAssertEqual(playlist.savedAt.timeIntervalSince1970, 1_700_000_001, accuracy: 0.001)
    }
}
