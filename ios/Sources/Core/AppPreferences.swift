import Foundation
import Observation

enum AppRepeatPreference: String, CaseIterable, Codable, Sendable {
    case off
    case all
    case one
}

@MainActor
@Observable
final class AppPreferences {
    static let shared = AppPreferences()

    var playbackQuality: PlaybackQuality {
        didSet { defaults.set(playbackQuality.rawValue, forKey: Keys.playbackQuality) }
    }
    var searchSource: MusicSource {
        didSet { defaults.set(searchSource.rawValue, forKey: Keys.searchSource) }
    }
    var volume: Double {
        didSet { defaults.set(min(1, max(0, volume)), forKey: Keys.volume) }
    }
    var isShuffleEnabled: Bool {
        didSet { defaults.set(isShuffleEnabled, forKey: Keys.shuffle) }
    }
    var repeatMode: AppRepeatPreference {
        didSet { defaults.set(repeatMode.rawValue, forKey: Keys.repeatMode) }
    }
    var imageCacheLimitMB: Int {
        didSet {
            let bounded = min(512, max(16, imageCacheLimitMB))
            defaults.set(bounded, forKey: Keys.imageCacheLimitMB)
        }
    }

    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults? = nil) {
        let resolvedDefaults = defaults
            ?? UserDefaults(suiteName: "group.io.bigrandall.rmusic")
            ?? .standard
        self.defaults = resolvedDefaults
        playbackQuality = PlaybackQuality(
            rawValue: resolvedDefaults.string(forKey: Keys.playbackQuality) ?? ""
        ) ?? .auto
        searchSource = MusicSource(
            rawValue: resolvedDefaults.string(forKey: Keys.searchSource) ?? ""
        ) ?? .aggregate
        volume = resolvedDefaults.object(forKey: Keys.volume) == nil
            ? 0.8
            : min(1, max(0, resolvedDefaults.double(forKey: Keys.volume)))
        isShuffleEnabled = resolvedDefaults.bool(forKey: Keys.shuffle)
        repeatMode = AppRepeatPreference(
            rawValue: resolvedDefaults.string(forKey: Keys.repeatMode) ?? ""
        ) ?? .off
        let storedLimit = resolvedDefaults.integer(forKey: Keys.imageCacheLimitMB)
        imageCacheLimitMB = storedLimit > 0 ? min(512, max(16, storedLimit)) : 64
    }

    func reset() {
        playbackQuality = .auto
        searchSource = .aggregate
        volume = 0.8
        isShuffleEnabled = false
        repeatMode = .off
        imageCacheLimitMB = 64
    }

    private enum Keys {
        static let playbackQuality = "preferences.playbackQuality"
        static let searchSource = "preferences.searchSource"
        static let volume = "preferences.volume"
        static let shuffle = "preferences.shuffle"
        static let repeatMode = "preferences.repeatMode"
        static let imageCacheLimitMB = "preferences.imageCacheLimitMB"
    }
}

typealias SettingsStore = AppPreferences
