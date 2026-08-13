import AVFoundation
import Foundation
import MediaPlayer
import Observation
import UIKit

enum PlaybackRepeatMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case off
    case list
    case one

    var id: Self { self }

    var symbolName: String {
        switch self {
        case .off, .list: "repeat"
        case .one: "repeat.1"
        }
    }

    var accessibilityName: String {
        switch self {
        case .off: "关闭循环"
        case .list: "列表循环"
        case .one: "单曲循环"
        }
    }
}

struct PlaybackError: Error, Equatable, Identifiable, Sendable {
    enum Code: String, Sendable {
        case missingStream
        case unauthorised
        case unavailable
        case network
        case consecutiveFailures
    }

    let code: Code
    let message: String
    let trackID: String?
    let underlyingDescription: String?

    var id: String { "\(code.rawValue)-\(trackID ?? "none")-\(message)" }
}

/// Native playback engine for the app, lock screen, headphones and WidgetKit.
/// Network dependencies are closures so account/session storage remains owned by Core.
@MainActor
@Observable
final class PlaybackController {
    typealias StreamRequestProvider = @MainActor (Track, PlaybackQuality) -> URLRequest?
    typealias LyricsRequestProvider = @MainActor (Track, Bool) -> URLRequest?
    typealias ArtworkRequestProvider = @MainActor (Track) -> URLRequest?
    typealias RecentPlayHandler = @MainActor (Track) async -> Void

    private(set) var currentTrack: Track?
    private(set) var queue: [Track] = []
    private(set) var queueIndex: Int?
    private(set) var isPlaying = false
    private(set) var isBuffering = false
    private(set) var currentTime: TimeInterval = 0
    private(set) var duration: TimeInterval = 0
    private(set) var bufferedFraction = 0.0
    private(set) var lyrics: LyricsDocument?
    private(set) var isLoadingLyrics = false
    private(set) var error: PlaybackError?

    private(set) var mode: PlaybackRepeatMode {
        didSet {
            preferences.set(mode.rawValue, forKey: PreferenceKey.repeatMode)
            updateRemoteCommandAvailability()
        }
    }

    private(set) var shuffle: Bool {
        didSet {
            preferences.set(shuffle, forKey: PreferenceKey.shuffle)
        }
    }

    private(set) var quality: PlaybackQuality {
        didSet {
            preferences.set(quality.rawValue, forKey: PreferenceKey.quality)
        }
    }

    var repeatMode: PlaybackRepeatMode {
        get { mode }
        set { setRepeatMode(newValue) }
    }

    var shuffleEnabled: Bool {
        get { shuffle }
        set { setShuffleEnabled(newValue) }
    }

    var repeatSymbol: String { mode.symbolName }
    var repeatAccessibilityLabel: String { mode.accessibilityName }

    @ObservationIgnored private let player: AVPlayer
    @ObservationIgnored private let streamRequestProvider: StreamRequestProvider
    @ObservationIgnored private let lyricsRequestProvider: LyricsRequestProvider?
    @ObservationIgnored private let artworkRequestProvider: ArtworkRequestProvider?
    @ObservationIgnored private let recentPlayHandler: RecentPlayHandler?
    @ObservationIgnored private let preferences: UserDefaults

    @ObservationIgnored private var canonicalQueue: [Track] = []
    @ObservationIgnored private var itemStatusObservation: NSKeyValueObservation?
    @ObservationIgnored private var keepUpObservation: NSKeyValueObservation?
    @ObservationIgnored private var playerStatusObservation: NSKeyValueObservation?
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var notificationTokens: [NSObjectProtocol] = []
    @ObservationIgnored private var remoteCommandTargets: [(MPRemoteCommand, Any)] = []
    @ObservationIgnored private var lyricsTask: Task<Void, Never>?
    @ObservationIgnored private var artworkTask: Task<Void, Never>?
    @ObservationIgnored private var pendingSeek: TimeInterval?
    @ObservationIgnored private var pendingAutoPlay = false
    @ObservationIgnored private var shouldRecordRecent = false
    @ObservationIgnored private var consecutiveFailures = 0
    @ObservationIgnored private var handledFailedItem: ObjectIdentifier?
    @ObservationIgnored private var needsReloadAfterFailure = false
    @ObservationIgnored private var playbackBecameContinuous = false
    @ObservationIgnored private var wasPlayingBeforeInterruption = false
    @ObservationIgnored private var lastWidgetSnapshotTime: TimeInterval = -1
    @ObservationIgnored private var lastNowPlayingInfoTime: TimeInterval = -1

    init(
        streamRequest: @escaping StreamRequestProvider,
        lyricsRequest: LyricsRequestProvider? = nil,
        artworkRequest: ArtworkRequestProvider? = nil,
        onRecentPlay: RecentPlayHandler? = nil,
        player: AVPlayer = AVPlayer(),
        preferences: UserDefaults = .standard
    ) {
        self.streamRequestProvider = streamRequest
        self.lyricsRequestProvider = lyricsRequest
        self.artworkRequestProvider = artworkRequest
        self.recentPlayHandler = onRecentPlay
        self.player = player
        self.preferences = preferences

        let storedMode = preferences.string(forKey: PreferenceKey.repeatMode)
            .flatMap(PlaybackRepeatMode.init(rawValue:))
        mode = storedMode ?? .off
        shuffle = preferences.object(forKey: PreferenceKey.shuffle) as? Bool ?? false
        let storedQuality = preferences.string(forKey: PreferenceKey.quality)
            .flatMap(PlaybackQuality.init(rawValue:))
        quality = storedQuality ?? .auto

        player.automaticallyWaitsToMinimizeStalling = true
        installPlayerObservers()
        installAudioNotifications()
        configureRemoteCommands()
    }

    convenience init(
        apiClient: RMusicAPIClient,
        onRecentPlay: RecentPlayHandler? = nil,
        player: AVPlayer = AVPlayer(),
        preferences: UserDefaults = .standard
    ) {
        self.init(
            streamRequest: { track, quality in
                guard let url = apiClient.streamURL(for: track, quality: quality) else { return nil }
                return Self.resourceRequest(for: url, apiClient: apiClient)
            },
            lyricsRequest: { track, wordSynced in
                let provided = track.lyricsURL(wordLevel: wordSynced)
                let fallback = try? apiClient.makeURL(
                    path: "/api/proxy/v2/lyrics/\(Self.pathComponent(track.source.rawValue))/\(Self.pathComponent(track.id))",
                    queryItems: wordSynced ? [URLQueryItem(name: "granularity", value: "word")] : []
                )
                guard let url = provided ?? fallback else { return nil }
                return Self.resourceRequest(for: url, apiClient: apiClient)
            },
            artworkRequest: { track in
                guard let url = apiClient.artworkURL(for: track) else { return nil }
                return Self.resourceRequest(for: url, apiClient: apiClient)
            },
            onRecentPlay: onRecentPlay ?? { track in
                try? await apiClient.addRecent(track)
            },
            player: player,
            preferences: preferences
        )
    }

    convenience init() {
        self.init(apiClient: .shared)
    }

    deinit {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        notificationTokens.forEach(NotificationCenter.default.removeObserver)
        remoteCommandTargets.forEach { command, target in command.removeTarget(target) }
    }

    func play(track: Track, in tracks: [Track] = []) {
        error = nil
        consecutiveFailures = 0
        let source = tracks.isEmpty ? [track] : tracks
        canonicalQueue = source.contains(where: { $0.stableID == track.stableID }) ? source : [track] + source

        if shuffle {
            queue = shuffledQueue(startingWith: track, from: canonicalQueue)
            queueIndex = 0
        } else {
            queue = canonicalQueue
            queueIndex = queue.firstIndex(where: { $0.stableID == track.stableID }) ?? 0
        }
        loadCurrent(autoPlay: true, resumeAt: nil, reloadResources: true, recordRecent: true)
    }

    func play() {
        if needsReloadAfterFailure, currentTrack != nil {
            error = nil
            consecutiveFailures = 0
            loadCurrent(
                autoPlay: true,
                resumeAt: currentTime > 0 ? currentTime : nil,
                reloadResources: false,
                recordRecent: shouldRecordRecent
            )
            return
        }
        guard currentTrack != nil, player.currentItem != nil else {
            guard !queue.isEmpty else { return }
            queueIndex = min(queueIndex ?? 0, queue.count - 1)
            loadCurrent(autoPlay: true, resumeAt: nil, reloadResources: true, recordRecent: true)
            return
        }

        configureAudioSession()
        pendingAutoPlay = true
        player.play()
        isPlaying = true
        isBuffering = player.timeControlStatus == .waitingToPlayAtSpecifiedRate
        updateNowPlayingState()
        saveWidgetSnapshot(reloadWidget: true)
    }

    func pause() {
        pendingAutoPlay = false
        player.pause()
        isPlaying = false
        isBuffering = false
        updateNowPlayingState()
        saveWidgetSnapshot(reloadWidget: true)
    }

    func toggle() {
        isPlaying ? pause() : play()
    }

    func next() {
        advance(by: 1, naturalEnd: false)
    }

    func playQueueItem(at index: Int) {
        guard queue.indices.contains(index) else { return }
        error = nil
        consecutiveFailures = 0
        queueIndex = index
        loadCurrent(autoPlay: true, resumeAt: nil, reloadResources: true, recordRecent: true)
    }

    func previous() {
        if currentTime > 3 {
            seek(to: 0)
            return
        }
        advance(by: -1, naturalEnd: false)
    }

    func seek(to time: TimeInterval) {
        guard currentTrack != nil else { return }
        let upperBound = duration > 0 ? duration : .greatestFiniteMagnitude
        let target = min(max(0, time), upperBound)
        currentTime = target
        let cmTime = CMTime(seconds: target, preferredTimescale: 600)
        player.seek(to: cmTime, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
            guard finished else { return }
            Task { @MainActor in
                self?.updateNowPlayingState()
                self?.saveWidgetSnapshot(reloadWidget: true)
            }
        }
    }

    func seek(by offset: TimeInterval) {
        seek(to: currentTime + offset)
    }

    func setQuality(_ newQuality: PlaybackQuality) {
        guard newQuality != quality else { return }
        quality = newQuality
        guard currentTrack != nil else { return }
        let resumeAt = currentTime
        let shouldResume = isPlaying || player.timeControlStatus == .waitingToPlayAtSpecifiedRate
        loadCurrent(
            autoPlay: shouldResume,
            resumeAt: resumeAt,
            reloadResources: false,
            recordRecent: false
        )
    }

    func setRepeatMode(_ newMode: PlaybackRepeatMode) {
        mode = newMode
    }

    func cycleRepeatMode() {
        switch mode {
        case .off: mode = .list
        case .list: mode = .one
        case .one: mode = .off
        }
    }

    func setShuffleEnabled(_ enabled: Bool) {
        guard enabled != shuffle else { return }
        let playingID = currentTrack?.stableID
        shuffle = enabled

        guard let playingID else { return }
        if enabled, let current = currentTrack {
            queue = shuffledQueue(startingWith: current, from: canonicalQueue)
            queueIndex = 0
        } else {
            queue = canonicalQueue
            queueIndex = queue.firstIndex(where: { $0.stableID == playingID })
        }
        updateRemoteCommandAvailability()
    }

    func toggleShuffle() {
        setShuffleEnabled(!shuffle)
    }

    func clearUpcoming() {
        guard let queueIndex, queue.indices.contains(queueIndex) else { return }
        queue = Array(queue.prefix(through: queueIndex))
        canonicalQueue = queue
        updateRemoteCommandAvailability()
    }

    func dismissError() {
        error = nil
    }

    func handleLogout() {
        stopAndClear()
    }

    func stopAndClear() {
        pendingAutoPlay = false
        pendingSeek = nil
        lyricsTask?.cancel()
        artworkTask?.cancel()
        tearDownItemObservers()
        player.pause()
        player.replaceCurrentItem(with: nil)
        currentTrack = nil
        queue = []
        canonicalQueue = []
        queueIndex = nil
        isPlaying = false
        isBuffering = false
        currentTime = 0
        duration = 0
        bufferedFraction = 0
        lyrics = nil
        isLoadingLyrics = false
        error = nil
        consecutiveFailures = 0
        handledFailedItem = nil
        needsReloadAfterFailure = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
        NowPlayingSnapshotStore.clear()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        updateRemoteCommandAvailability()
    }

    private func loadCurrent(
        autoPlay: Bool,
        resumeAt: TimeInterval?,
        reloadResources: Bool,
        recordRecent: Bool
    ) {
        guard let index = queueIndex, queue.indices.contains(index) else { return }
        let track = queue[index]
        currentTrack = track
        pendingAutoPlay = autoPlay
        pendingSeek = resumeAt
        shouldRecordRecent = recordRecent
        playbackBecameContinuous = false
        currentTime = resumeAt ?? 0
        duration = track.duration
        bufferedFraction = 0
        isBuffering = autoPlay
        isPlaying = autoPlay
        lastWidgetSnapshotTime = -1
        lastNowPlayingInfoTime = -1
        tearDownItemObservers()
        player.pause()
        player.replaceCurrentItem(with: nil)

        if reloadResources {
            loadLyrics(for: track)
            loadArtwork(for: track)
        }
        updateStaticNowPlayingInfo(for: track)
        saveWidgetSnapshot(reloadWidget: true)
        updateRemoteCommandAvailability()

        guard let request = streamRequestProvider(track, quality), let url = request.url else {
            handlePlaybackFailure(
                PlaybackError(
                    code: .missingStream,
                    message: "这首歌暂时没有可用的播放地址。",
                    trackID: track.stableID,
                    underlyingDescription: nil
                )
            )
            return
        }

        configureAudioSession()
        let asset = AVURLAsset(url: url, options: assetOptions(for: request))
        let item = AVPlayerItem(asset: asset)
        handledFailedItem = nil
        needsReloadAfterFailure = false
        item.preferredForwardBufferDuration = 20
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = false
        installItemObservers(item)
        player.replaceCurrentItem(with: item)

        if autoPlay, resumeAt == nil {
            player.play()
        } else {
            player.pause()
        }

    }

    private func installPlayerObservers() {
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor in self?.handlePeriodicTime(time) }
        }

        playerStatusObservation = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] player, _ in
            Task { @MainActor in self?.handleTimeControlStatus(player.timeControlStatus) }
        }
    }

    private func installItemObservers(_ item: AVPlayerItem) {
        itemStatusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
            guard let item else { return }
            Task { @MainActor in self?.handleItemStatus(item) }
        }
        keepUpObservation = item.observe(\.isPlaybackLikelyToKeepUp, options: [.initial, .new]) { [weak self, weak item] _, _ in
            guard let item else { return }
            Task { @MainActor in
                guard let self, item === self.player.currentItem else { return }
                if !item.isPlaybackLikelyToKeepUp, self.pendingAutoPlay || self.isPlaying {
                    self.markStalled()
                }
            }
        }

        let center = NotificationCenter.default
        notificationTokens.append(center.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.handlePlaybackEnded() }
        })
        notificationTokens.append(center.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self, weak item] notification in
            let underlying = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            Task { @MainActor in
                guard let item else { return }
                self?.handleItemError(underlying, item: item)
            }
        })
        notificationTokens.append(center.addObserver(
            forName: .AVPlayerItemPlaybackStalled,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.markStalled() }
        })
    }

    private func tearDownItemObservers() {
        itemStatusObservation?.invalidate()
        keepUpObservation?.invalidate()
        itemStatusObservation = nil
        keepUpObservation = nil

        let center = NotificationCenter.default
        notificationTokens.removeAll { token in
            // Audio-session tokens have a nil object and are installed once;
            // item tokens are safely recreated as a group after this method.
            let isAudioToken = audioNotificationTokens.contains(where: { $0 === token })
            if !isAudioToken { center.removeObserver(token) }
            return !isAudioToken
        }
    }

    @ObservationIgnored private var audioNotificationTokens: [NSObjectProtocol] = []

    private func installAudioNotifications() {
        let center = NotificationCenter.default
        let interruption = center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleAudioInterruption(notification) }
        }
        let reset = center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.configureAudioSession() }
        }
        let routeChange = center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleAudioRouteChange(notification) }
        }
        audioNotificationTokens = [interruption, reset, routeChange]
        notificationTokens.append(contentsOf: audioNotificationTokens)
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [.allowAirPlay])
            try session.setActive(true)
        } catch {
            self.error = PlaybackError(
                code: .unavailable,
                message: "无法启动系统音频播放。",
                trackID: currentTrack?.stableID,
                underlyingDescription: error.localizedDescription
            )
        }
    }

    private func handleAudioInterruption(_ notification: Notification) {
        guard let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: value) else { return }
        switch type {
        case .began:
            wasPlayingBeforeInterruption = isPlaying
            pendingAutoPlay = false
            player.pause()
            isPlaying = false
            isBuffering = false
            updateNowPlayingState()
            saveWidgetSnapshot(reloadWidget: true)
        case .ended:
            let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            if wasPlayingBeforeInterruption, options.contains(.shouldResume) { play() }
            wasPlayingBeforeInterruption = false
        @unknown default:
            break
        }
    }

    private func handleAudioRouteChange(_ notification: Notification) {
        guard let value = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: value) == .oldDeviceUnavailable,
              isPlaying else { return }
        // Match the system Music app: unplugging wired/Bluetooth output must not
        // unexpectedly move private audio to the device speaker.
        pause()
    }

    private func handleItemStatus(_ item: AVPlayerItem) {
        guard item === player.currentItem else { return }
        switch item.status {
        case .readyToPlay:
            duration = validSeconds(item.duration.seconds) ?? currentTrack?.duration ?? 0
            if let pendingSeek {
                self.pendingSeek = nil
                let target = duration > 0 ? min(pendingSeek, max(0, duration - 0.1)) : pendingSeek
                player.seek(
                    to: CMTime(seconds: max(0, target), preferredTimescale: 600),
                    toleranceBefore: .zero,
                    toleranceAfter: .zero
                ) { [weak self] finished in
                    guard finished else { return }
                    Task { @MainActor in
                        guard let self, self.pendingAutoPlay else { return }
                        self.player.play()
                    }
                }
            } else if pendingAutoPlay {
                player.play()
            }
            recordRecentIfNeeded()
            updateNowPlayingState()
            saveWidgetSnapshot(reloadWidget: true)
        case .failed:
            handleItemError(item.error, item: item)
        case .unknown:
            break
        @unknown default:
            break
        }
    }

    private func handleTimeControlStatus(_ status: AVPlayer.TimeControlStatus) {
        let previousPlaying = isPlaying
        let previousBuffering = isBuffering
        switch status {
        case .playing:
            isPlaying = true
            isBuffering = false
        case .waitingToPlayAtSpecifiedRate:
            isPlaying = pendingAutoPlay || player.rate > 0
            isBuffering = currentTrack != nil && isPlaying
        case .paused:
            if pendingSeek == nil {
                isPlaying = false
                isBuffering = false
            }
        @unknown default:
            break
        }
        lastNowPlayingInfoTime = currentTime
        updateNowPlayingState()
        if previousPlaying != isPlaying || previousBuffering != isBuffering {
            saveWidgetSnapshot(reloadWidget: true)
        }
    }

    private func handlePeriodicTime(_ time: CMTime) {
        guard currentTrack != nil else { return }
        let previousDuration = duration
        if let seconds = validSeconds(time.seconds) { currentTime = seconds }
        if let item = player.currentItem {
            if let itemDuration = validSeconds(item.duration.seconds), itemDuration > 0 { duration = itemDuration }
            updateBufferedFraction(from: item)
        }
        if abs(duration - previousDuration) > 0.25 {
            saveWidgetSnapshot(reloadWidget: true)
        }

        if currentTime >= 1, !playbackBecameContinuous {
            playbackBecameContinuous = true
            consecutiveFailures = 0
            error = nil
        }
        if lastNowPlayingInfoTime < 0 || abs(currentTime - lastNowPlayingInfoTime) >= 5 {
            lastNowPlayingInfoTime = currentTime
            updateNowPlayingState()
        }

        if lastWidgetSnapshotTime < 0 || abs(currentTime - lastWidgetSnapshotTime) >= 15 {
            lastWidgetSnapshotTime = currentTime
            saveWidgetSnapshot(reloadWidget: false)
        }
    }

    private func updateBufferedFraction(from item: AVPlayerItem) {
        guard duration > 0 else {
            bufferedFraction = 0
            return
        }
        let furthestEnd = item.loadedTimeRanges.compactMap { value -> TimeInterval? in
            let range = value.timeRangeValue
            return validSeconds(CMTimeGetSeconds(CMTimeRangeGetEnd(range)))
        }.max() ?? 0
        bufferedFraction = min(1, max(0, furthestEnd / duration))
    }

    private func handlePlaybackEnded() {
        consecutiveFailures = 0
        if mode == .one {
            seek(to: 0)
            play()
        } else {
            advance(by: 1, naturalEnd: true)
        }
    }

    private func advance(by offset: Int, naturalEnd: Bool) {
        guard !queue.isEmpty, let index = queueIndex else { return }
        var destination = index + offset
        if !queue.indices.contains(destination) {
            if mode == .list {
                destination = offset >= 0 ? 0 : queue.count - 1
            } else {
                if offset < 0 { seek(to: 0) }
                if naturalEnd || offset > 0 {
                    pendingAutoPlay = false
                    player.pause()
                    isPlaying = false
                    isBuffering = false
                    updateNowPlayingState()
                    saveWidgetSnapshot(reloadWidget: true)
                }
                return
            }
        }
        queueIndex = destination
        loadCurrent(autoPlay: true, resumeAt: nil, reloadResources: true, recordRecent: true)
    }

    private func markStalled() {
        guard pendingAutoPlay || isPlaying else { return }
        guard !isBuffering else { return }
        isBuffering = true
        updateNowPlayingState()
        saveWidgetSnapshot(reloadWidget: true)
    }

    private func handleItemError(_ underlying: Error?, item: AVPlayerItem) {
        guard item === player.currentItem else { return }
        let identifier = ObjectIdentifier(item)
        guard handledFailedItem != identifier else { return }
        handledFailedItem = identifier
        needsReloadAfterFailure = true
        let nsError = underlying as NSError?
        let code: PlaybackError.Code
        let message: String
        if nsError?.code == NSURLErrorUserAuthenticationRequired || nsError?.code == 401 {
            code = .unauthorised
            message = "登录已失效，请重新登录后继续播放。"
        } else if nsError?.code == NSURLErrorNoPermissionsToReadFile
                    || nsError?.code == NSURLErrorFileDoesNotExist
                    || nsError?.code == NSURLErrorCannotOpenFile
                    || nsError?.code == 403
                    || nsError?.code == 404 {
            // AVURLAsset commonly maps an HTTP 403 to NSURLError -1102.
            code = .unavailable
            message = "当前音源不可用，可能需要平台会员或受地区限制。"
        } else if nsError?.domain == NSURLErrorDomain {
            code = .network
            message = "网络连接中断，无法继续播放这首歌。"
        } else {
            code = .unavailable
            message = "当前音源无法播放这首歌。"
        }
        handlePlaybackFailure(
            PlaybackError(
                code: code,
                message: message,
                trackID: currentTrack?.stableID,
                underlyingDescription: underlying?.localizedDescription
            )
        )
    }

    private func handlePlaybackFailure(_ failure: PlaybackError) {
        needsReloadAfterFailure = true
        error = failure
        consecutiveFailures += 1
        pendingAutoPlay = false
        player.pause()
        isPlaying = false
        isBuffering = false

        guard consecutiveFailures < 3 else {
            error = PlaybackError(
                code: .consecutiveFailures,
                message: "连续三首歌曲播放失败，已停止自动跳过。请检查登录或网络后重试。",
                trackID: currentTrack?.stableID,
                underlyingDescription: failure.underlyingDescription
            )
            updateNowPlayingState()
            saveWidgetSnapshot(reloadWidget: true)
            return
        }
        advanceAfterFailure()
    }

    private func advanceAfterFailure() {
        guard !queue.isEmpty, let index = queueIndex else { return }
        var destination = index + 1
        if destination >= queue.count {
            guard mode == .list else {
                updateNowPlayingState()
                saveWidgetSnapshot(reloadWidget: true)
                return
            }
            destination = 0
        }
        // A one-item queue cannot recover by retrying the same unavailable URL.
        guard destination != index else {
            updateNowPlayingState()
            saveWidgetSnapshot(reloadWidget: true)
            return
        }
        queueIndex = destination
        loadCurrent(autoPlay: true, resumeAt: nil, reloadResources: true, recordRecent: true)
    }

    private func recordRecentIfNeeded() {
        guard shouldRecordRecent, let track = currentTrack else { return }
        shouldRecordRecent = false
        guard let recentPlayHandler else { return }
        Task { await recentPlayHandler(track) }
    }

    private func loadLyrics(for track: Track) {
        lyricsTask?.cancel()
        lyrics = nil
        guard let lyricsRequestProvider else {
            isLoadingLyrics = false
            return
        }
        let requests = [
            lyricsRequestProvider(track, true),
            lyricsRequestProvider(track, false)
        ].compactMap { $0 }
        guard !requests.isEmpty else {
            isLoadingLyrics = false
            return
        }

        isLoadingLyrics = true
        let expectedTrackID = track.stableID
        lyricsTask = Task { [weak self] in
            for request in requests {
                guard !Task.isCancelled else { return }
                do {
                    let (data, response) = try await URLSession.shared.data(for: request)
                    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                          let source = String(data: data, encoding: .utf8) else { continue }
                    let parsed = LRCParser.parse(source)
                    guard !parsed.isEmpty else { continue }
                    guard !Task.isCancelled, self?.currentTrack?.stableID == expectedTrackID else { return }
                    self?.lyrics = parsed
                    self?.isLoadingLyrics = false
                    return
                } catch where error is CancellationError {
                    return
                } catch {
                    continue
                }
            }
            guard !Task.isCancelled, self?.currentTrack?.stableID == expectedTrackID else { return }
            self?.lyrics = .empty
            self?.isLoadingLyrics = false
        }
    }

    private func loadArtwork(for track: Track) {
        artworkTask?.cancel()
        // Never show the previous track's cover while a new one is downloading.
        NowPlayingSnapshotStore.saveArtwork(nil)
        guard let artworkRequestProvider, let request = artworkRequestProvider(track) else {
            return
        }
        let expectedTrackID = track.stableID
        artworkTask = Task { [weak self] in
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard !Task.isCancelled,
                      let http = response as? HTTPURLResponse,
                      (200..<300).contains(http.statusCode),
                      let image = UIImage(data: data),
                      self?.currentTrack?.stableID == expectedTrackID else { return }
                self?.installNowPlayingArtwork(image)
                NowPlayingSnapshotStore.saveArtwork(data)
            } catch {
                guard !Task.isCancelled, self?.currentTrack?.stableID == expectedTrackID else { return }
                NowPlayingSnapshotStore.saveArtwork(nil)
            }
        }
    }

    private func updateStaticNowPlayingInfo(for track: Track) {
        let previousInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artistsText,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: player.rate,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyExternalContentIdentifier: track.stableID
        ]
        if !track.albumName.isEmpty { info[MPMediaItemPropertyAlbumTitle] = track.albumName }
        if previousInfo?[MPNowPlayingInfoPropertyExternalContentIdentifier] as? String == track.stableID,
           let artwork = previousInfo?[MPMediaItemPropertyArtwork] {
            info[MPMediaItemPropertyArtwork] = artwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
    }

    private func installNowPlayingArtwork(_ image: UIImage) {
        guard currentTrack != nil else { return }
        let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyArtwork] = artwork
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updateNowPlayingState() {
        guard currentTrack != nil else { return }
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPMediaItemPropertyPlaybackDuration] = duration
        info[MPNowPlayingInfoPropertyPlaybackRate] = player.rate
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
    }

    private func saveWidgetSnapshot(reloadWidget: Bool) {
        guard let track = currentTrack else { return }
        NowPlayingSnapshotStore.save(
            NowPlayingSnapshot(
                trackID: track.stableID,
                source: track.source.rawValue,
                title: track.title,
                artist: track.artistsText,
                album: track.albumName.isEmpty ? nil : track.albumName,
                artworkURL: track.artworkURL,
                currentTime: currentTime,
                duration: duration,
                isPlaying: isPlaying,
                isBuffering: isBuffering,
                capturedAt: .now
            ),
            reloadWidget: reloadWidget
        )
    }

    private func assetOptions(for request: URLRequest) -> [String: Any] {
        var options: [String: Any] = [
            AVURLAssetAllowsCellularAccessKey: true,
            AVURLAssetAllowsExpensiveNetworkAccessKey: true,
            AVURLAssetAllowsConstrainedNetworkAccessKey: true
        ]
        if let headers = request.allHTTPHeaderFields, !headers.isEmpty {
            // The Objective-C key is available to AVFoundation at runtime but
            // current Swift SDK overlays do not import its symbol.
            options["AVURLAssetHTTPHeaderFieldsKey"] = headers
        }
        if let url = request.url {
            let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
            if !cookies.isEmpty { options[AVURLAssetHTTPCookiesKey] = cookies }
        }
        return options
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.preferredIntervals = [15]

        addTarget(to: center.playCommand) { $0.play() }
        addTarget(to: center.pauseCommand) { $0.pause() }
        addTarget(to: center.togglePlayPauseCommand) { $0.toggle() }
        addTarget(to: center.nextTrackCommand) { $0.next() }
        addTarget(to: center.previousTrackCommand) { $0.previous() }
        addTarget(to: center.skipForwardCommand) { controller in controller.seek(by: 15) }
        addTarget(to: center.skipBackwardCommand) { controller in controller.seek(by: -15) }

        let positionTarget = center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(to: event.positionTime) }
            return self == nil ? .noSuchContent : .success
        }
        remoteCommandTargets.append((center.changePlaybackPositionCommand, positionTarget))
        updateRemoteCommandAvailability()
    }

    private func addTarget(to command: MPRemoteCommand, action: @escaping @MainActor (PlaybackController) -> Void) {
        let target = command.addTarget { [weak self] _ in
            guard self != nil else { return .noSuchContent }
            Task { @MainActor [weak self] in
                guard let self else { return }
                action(self)
            }
            return .success
        }
        remoteCommandTargets.append((command, target))
    }

    private func updateRemoteCommandAvailability() {
        let center = MPRemoteCommandCenter.shared()
        let hasTrack = currentTrack != nil
        center.playCommand.isEnabled = hasTrack
        center.pauseCommand.isEnabled = hasTrack
        center.togglePlayPauseCommand.isEnabled = hasTrack
        center.changePlaybackPositionCommand.isEnabled = hasTrack
        center.skipForwardCommand.isEnabled = hasTrack
        center.skipBackwardCommand.isEnabled = hasTrack
        center.nextTrackCommand.isEnabled = hasTrack && (queue.count > 1 || mode == .list)
        center.previousTrackCommand.isEnabled = hasTrack
    }

    private func validSeconds(_ value: TimeInterval) -> TimeInterval? {
        value.isFinite && !value.isNaN && value >= 0 ? value : nil
    }

    private func shuffledQueue(startingWith current: Track, from source: [Track]) -> [Track] {
        var remaining = source
        if let index = remaining.firstIndex(where: { $0.stableID == current.stableID }) {
            remaining.remove(at: index)
        }
        return [current] + remaining.shuffled()
    }

    /// Bearer credentials are only meaningful to the RMusic origin. Old saved
    /// tracks can contain an external CDN URL, which must never receive them.
    private static func resourceRequest(for url: URL, apiClient: RMusicAPIClient) -> URLRequest {
        let isRMusicOrigin = url.scheme?.lowercased() == apiClient.baseURL.scheme?.lowercased()
            && url.host?.lowercased() == apiClient.baseURL.host?.lowercased()
            && effectivePort(of: url) == effectivePort(of: apiClient.baseURL)
        guard isRMusicOrigin else {
            var request = URLRequest(url: url)
            request.setValue("*/*", forHTTPHeaderField: "Accept")
            return request
        }
        return apiClient.authorizedRequest(for: url)
    }

    private static func effectivePort(of url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "https": return 443
        case "http": return 80
        default: return nil
        }
    }

    private static func pathComponent(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private enum PreferenceKey {
        static let quality = "playback.quality.v1"
        static let repeatMode = "playback.repeatMode.v1"
        static let shuffle = "playback.shuffle.v1"
    }
}
