import AVFoundation
import XCTest
@testable import RMusic

@MainActor
final class PlaybackControllerTests: XCTestCase {
    func testUserSelectedFailureStaysOnSelectedTrack() {
        let first = Track(id: "first", source: .netease, title: "First")
        let second = Track(id: "second", source: .netease, title: "Second")
        let controller = makeController { _, _ in nil }

        controller.play(track: first, in: [first, second])

        XCTAssertEqual(controller.currentTrack?.stableID, first.stableID)
        XCTAssertEqual(controller.queueIndex, 0)
        XCTAssertEqual(controller.error?.code, .missingStream)
        XCTAssertFalse(controller.isPlaying)
        XCTAssertFalse(controller.isBuffering)
    }

    func testManualNextFailureDoesNotSkipAnotherTrack() throws {
        let first = Track(id: "first", source: .netease, title: "First")
        let second = Track(id: "second", source: .netease, title: "Second")
        let third = Track(id: "third", source: .netease, title: "Third")
        let playableURL = try makeSilentAudioURL()
        defer { try? FileManager.default.removeItem(at: playableURL) }
        let controller = makeController { track, _ in
            track.stableID == first.stableID ? URLRequest(url: playableURL) : nil
        }

        controller.play(track: first, in: [first, second, third])
        controller.next()

        XCTAssertEqual(controller.currentTrack?.stableID, second.stableID)
        XCTAssertEqual(controller.queueIndex, 1)
        XCTAssertEqual(controller.error?.code, .missingStream)
    }

    func testNaturalQueueProgressionSkipsUnavailableTrack() async throws {
        let first = Track(id: "first", source: .netease, title: "First")
        let unavailable = Track(id: "unavailable", source: .netease, title: "Unavailable")
        let recovered = Track(id: "recovered", source: .netease, title: "Recovered")
        let playableURL = try makeSilentAudioURL()
        defer { try? FileManager.default.removeItem(at: playableURL) }
        let player = AVPlayer()
        let controller = makeController(player: player) { track, _ in
            track.stableID == unavailable.stableID ? nil : URLRequest(url: playableURL)
        }

        controller.play(track: first, in: [first, unavailable, recovered])
        let completedItem = try XCTUnwrap(player.currentItem)
        NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: completedItem)

        for _ in 0..<10 where controller.currentTrack?.stableID != recovered.stableID {
            await Task.yield()
        }

        XCTAssertEqual(controller.currentTrack?.stableID, recovered.stableID)
        XCTAssertEqual(controller.queueIndex, 2)
        XCTAssertNil(controller.error)
    }

    private func makeController(
        player: AVPlayer = AVPlayer(),
        streamRequest: @escaping PlaybackController.StreamRequestProvider
    ) -> PlaybackController {
        let suiteName = "PlaybackControllerTests.\(UUID().uuidString)"
        let preferences = UserDefaults(suiteName: suiteName)!
        preferences.removePersistentDomain(forName: suiteName)
        return PlaybackController(
            streamRequest: streamRequest,
            player: player,
            preferences: preferences
        )
    }

    private func makeSilentAudioURL() throws -> URL {
        let sampleRate: UInt32 = 8_000
        let sampleCount: UInt32 = 2_000
        var data = Data()

        func append(_ string: String) {
            data.append(string.data(using: .ascii)!)
        }
        func append(_ number: UInt16) {
            var value = number.littleEndian
            withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
        }
        func append(_ number: UInt32) {
            var value = number.littleEndian
            withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
        }

        append("RIFF")
        append(36 + sampleCount)
        append("WAVE")
        append("fmt ")
        append(UInt32(16))
        append(UInt16(1)) // PCM
        append(UInt16(1)) // mono
        append(sampleRate)
        append(sampleRate) // 8-bit mono bytes per second
        append(UInt16(1)) // block alignment
        append(UInt16(8)) // bits per sample
        append("data")
        append(sampleCount)
        data.append(Data(repeating: 128, count: Int(sampleCount)))

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("rmusic-playback-test-\(UUID().uuidString).wav")
        try data.write(to: url, options: .atomic)
        return url
    }
}
