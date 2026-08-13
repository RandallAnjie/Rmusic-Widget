import Foundation
import UIKit
import WidgetKit

/// JSON contract shared with the WidgetKit extension. It intentionally contains
/// display-only values so the widget never needs account credentials.
struct NowPlayingSnapshot: Codable, Hashable, Sendable {
    let trackID: String
    let source: String
    let title: String
    let artist: String
    let album: String?
    let artworkURL: URL?
    let currentTime: TimeInterval
    let duration: TimeInterval
    let isPlaying: Bool
    let isBuffering: Bool?
    let capturedAt: Date
}

enum NowPlayingSnapshotStore {
    static let appGroup = "group.io.bigrandall.rmusic"
    static let snapshotKey = "nowPlayingSnapshot.v1"
    static let artworkFilename = "now-playing-artwork.jpg"

    static func save(_ snapshot: NowPlayingSnapshot, reloadWidget: Bool = true) {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)
        if reloadWidget { WidgetCenter.shared.reloadTimelines(ofKind: "RMusicNowPlayingWidget") }
    }

    static func clear() {
        UserDefaults(suiteName: appGroup)?.removeObject(forKey: snapshotKey)
        if let url = artworkFileURL() {
            try? FileManager.default.removeItem(at: url)
        }
        WidgetCenter.shared.reloadTimelines(ofKind: "RMusicNowPlayingWidget")
    }

    /// Normalises remote artwork to a bounded JPEG before it enters the shared
    /// container. This avoids letting a provider's original image fill defaults
    /// or the app-group container.
    static func saveArtwork(_ data: Data?) {
        guard let url = artworkFileURL() else { return }
        guard let data,
              let image = UIImage(data: data),
              let normalised = resizedJPEG(image, maximumDimension: 700) else {
            try? FileManager.default.removeItem(at: url)
            WidgetCenter.shared.reloadTimelines(ofKind: "RMusicNowPlayingWidget")
            return
        }

        try? normalised.write(to: url, options: .atomic)
        WidgetCenter.shared.reloadTimelines(ofKind: "RMusicNowPlayingWidget")
    }

    private static func artworkFileURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(artworkFilename, isDirectory: false)
    }

    private static func resizedJPEG(_ image: UIImage, maximumDimension: CGFloat) -> Data? {
        let sourceSize = image.size
        guard sourceSize.width > 0, sourceSize.height > 0 else { return nil }
        let scale = min(1, maximumDimension / max(sourceSize.width, sourceSize.height))
        let target = CGSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        let rendered = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return rendered.jpegData(compressionQuality: 0.82)
    }
}
