import SwiftUI

struct NowPlayingView: View {
    @Environment(RMusicAppModel.self) private var model
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let onDismiss: () -> Void

    @State private var panel: PlayerPanel = .lyrics
    @State private var scrubValue: Double = 0
    @State private var isScrubbing = false
    @State private var showQuality = false

    var body: some View {
        ZStack {
            artworkBackdrop
            RMusicTheme.background.opacity(0.74)

            VStack(spacing: 0) {
                header
                if verticalSizeClass == .compact {
                    landscapeBody
                } else {
                    portraitBody
                }
            }
        }
        .foregroundStyle(RMusicTheme.textPrimary)
        .preferredColorScheme(.dark)
        .onChange(of: model.playback.currentTime) { _, newValue in
            if !isScrubbing { scrubValue = newValue }
        }
        .onChange(of: model.playback.currentTrack?.stableID) { _, _ in
            scrubValue = model.playback.currentTime
        }
        .sheet(isPresented: $showQuality) {
            qualitySheet
                .presentationDetents([.height(360)])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
        }
    }

    private var artworkBackdrop: some View {
        AuthenticatedArtworkImage(url: model.playback.currentTrack?.artworkURL) {
            RMusicTheme.background
        }
        .blur(radius: reduceMotion ? 0 : 58)
        .saturation(1.28)
        .opacity(reduceMotion ? 0.12 : 0.34)
        .scaleEffect(1.25)
        .ignoresSafeArea()
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button(action: onDismiss) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 17, weight: .bold))
                    .frame(width: 44, height: 44)
                    .background(.white.opacity(0.08), in: Circle())
            }
            .buttonStyle(RMusicPressStyle(pressedScale: 0.9))
            .accessibilityLabel("收起正在播放")

            Picker("显示内容", selection: $panel) {
                ForEach(PlayerPanel.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 260)

            Spacer()

            Button { showQuality = true } label: {
                Image(systemName: "waveform.badge.gearshape")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .background(.white.opacity(0.08), in: Circle())
            }
            .buttonStyle(RMusicPressStyle(pressedScale: 0.9))
            .accessibilityLabel("播放设置")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    private var portraitBody: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 22) {
                    currentArtwork(size: min(proxy.size.width * 0.66, 278))
                    metadata
                    playbackErrorBanner
                    scrubber
                    controls
                    panelView
                        .frame(minHeight: max(300, proxy.size.height * 0.44))
                }
                .padding(.horizontal, 22)
                .padding(.top, 8)
                .padding(.bottom, 34)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
    }

    private var landscapeBody: some View {
        GeometryReader { proxy in
            VStack(spacing: 10) {
                HStack(spacing: 24) {
                    currentArtwork(size: min(proxy.size.height * 0.50, 150))
                    VStack(spacing: 12) {
                        metadata
                        playbackErrorBanner
                        scrubber
                        controls
                    }
                }
                .padding(.horizontal, 28)
                .padding(.top, 4)

                panelView
                    .frame(maxHeight: .infinity)
                    .padding(.horizontal, 22)
            }
        }
    }

    private func currentArtwork(size: CGFloat) -> some View {
        Group {
            if let track = model.playback.currentTrack {
                ArtworkView(url: track.artworkURL, title: track.title, size: size, cornerRadius: max(18, size * 0.075))
                    .shadow(color: .black.opacity(0.5), radius: 36, y: 18)
            } else {
                EmptyArtwork(title: "RMusic", size: size)
            }
        }
        .accessibilityHidden(true)
    }

    private var metadata: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(model.playback.currentTrack?.title ?? "选择一首歌曲")
                    .font(.title2.weight(.bold))
                    .tracking(-0.35)
                    .lineLimit(2)
                Text(model.playback.currentTrack?.artistsText ?? "从搜索或歌单开始")
                    .font(.body)
                    .foregroundStyle(RMusicTheme.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            if let track = model.playback.currentTrack {
                Button {
                    model.requireAccount { model.toggleFavorite(track) }
                } label: {
                    Image(systemName: model.library.isFavorite(track) ? "heart.fill" : "heart")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(model.library.isFavorite(track) ? RMusicTheme.accent : RMusicTheme.textPrimary)
                        .frame(width: 48, height: 48)
                        .background(.white.opacity(0.08), in: Circle())
                }
                .buttonStyle(RMusicPressStyle(pressedScale: 0.9))
                .accessibilityLabel(model.library.isFavorite(track) ? "取消喜欢" : "喜欢")
            }
        }
        .frame(maxWidth: 520)
    }

    private var scrubber: some View {
        VStack(spacing: 4) {
            Slider(
                value: $scrubValue,
                in: 0...max(model.playback.duration, 1),
                onEditingChanged: { editing in
                    isScrubbing = editing
                    if !editing {
                        model.playback.seek(to: scrubValue)
                        RMusicHaptics.selection()
                    }
                }
            )
            .tint(RMusicTheme.accent)
            .accessibilityLabel("播放进度")
            .accessibilityValue("\(formatTime(scrubValue))，共 \(formatTime(model.playback.duration))")

            HStack {
                Text(formatTime(isScrubbing ? scrubValue : model.playback.currentTime))
                Spacer()
                Text("-\(formatTime(max(model.playback.duration - (isScrubbing ? scrubValue : model.playback.currentTime), 0)))")
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(RMusicTheme.textSecondary)
        }
        .frame(maxWidth: 620)
    }

    @ViewBuilder
    private var playbackErrorBanner: some View {
        if let error = model.playback.error {
            ErrorBanner(message: error.message) {
                model.playback.play()
                RMusicHaptics.impact(.medium)
            }
            .frame(maxWidth: 620)
            .accessibilityLabel("播放失败：\(error.message)")
        }
    }

    private var controls: some View {
        HStack(spacing: 8) {
            controlButton(symbol: "shuffle", active: model.playback.shuffleEnabled, label: model.playback.shuffleEnabled ? "关闭随机播放" : "开启随机播放") {
                model.playback.setShuffleEnabled(!model.playback.shuffleEnabled)
                RMusicHaptics.selection()
            }

            controlButton(symbol: "backward.end.fill", size: 22, label: "上一首") {
                model.playback.previous()
                RMusicHaptics.impact()
            }

            Button {
                model.playback.toggle()
                RMusicHaptics.impact(.medium)
            } label: {
                Group {
                    if model.playback.isBuffering {
                        ProgressView().tint(RMusicTheme.accentInk)
                    } else {
                        Image(systemName: model.playback.isPlaying ? "pause.fill" : "play.fill")
                    }
                }
                .font(.system(size: 27, weight: .black))
                .foregroundStyle(RMusicTheme.accentInk)
                .frame(width: 64, height: 64)
                .background(RMusicTheme.accent, in: Circle())
                .shadow(color: RMusicTheme.accent.opacity(0.22), radius: 18)
            }
            .buttonStyle(RMusicPressStyle(pressedScale: 0.9))
            .disabled(model.playback.currentTrack == nil)
            .accessibilityLabel(model.playback.isPlaying ? "暂停" : "播放")

            controlButton(symbol: "forward.end.fill", size: 22, label: "下一首") {
                model.playback.next()
                RMusicHaptics.impact()
            }

            controlButton(symbol: model.playback.repeatSymbol, active: model.playback.repeatMode != .off, label: model.playback.repeatAccessibilityLabel) {
                model.playback.cycleRepeatMode()
                RMusicHaptics.selection()
            }
        }
        .frame(maxWidth: 520)
    }

    private func controlButton(symbol: String, active: Bool = false, size: CGFloat = 18, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(active ? RMusicTheme.accent : RMusicTheme.textPrimary)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .contentShape(Rectangle())
        }
        .buttonStyle(RMusicPressStyle(pressedScale: 0.9))
        .disabled(model.playback.currentTrack == nil)
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private var panelView: some View {
        switch panel {
        case .lyrics: LyricsPanelView()
        case .queue: QueuePanelView()
        }
    }

    private var qualitySheet: some View {
        NavigationStack {
            List {
                ForEach(PlaybackQuality.allCases) { (quality: PlaybackQuality) in
                    Button {
                        model.playback.setQuality(quality)
                        RMusicHaptics.selection()
                        showQuality = false
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(quality.displayName)
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(RMusicTheme.textPrimary)
                                Text(quality.detailText)
                                    .font(.caption)
                                    .foregroundStyle(RMusicTheme.textSecondary)
                            }
                            Spacer()
                            if model.playback.quality == quality {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(RMusicTheme.accent)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(RMusicTheme.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(RMusicTheme.background)
            .navigationTitle("播放音质")
            .navigationBarTitleDisplayMode(.inline)
        }
        .preferredColorScheme(.dark)
    }

    private func formatTime(_ value: TimeInterval) -> String {
        guard value.isFinite, value >= 0 else { return "0:00" }
        let total = Int(value.rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

private enum PlayerPanel: String, CaseIterable, Identifiable {
    case lyrics
    case queue
    var id: String { rawValue }
    var title: String { self == .lyrics ? "歌词" : "队列" }
}

extension PlaybackQuality {
    var detailText: String {
        switch self {
        case .auto: "根据曲目与网络自动选择"
        case .lossless: "优先 FLAC 或平台最高无损档位"
        case .high: "优先 320 kbps 高品质音频"
        case .standard: "兼顾音质与流量"
        case .low: "降低移动网络流量占用"
        }
    }
}
