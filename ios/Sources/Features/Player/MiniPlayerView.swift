import SwiftUI

struct MiniPlayerView: View {
    @Environment(RMusicAppModel.self) private var model
    let onOpen: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Color.white.opacity(0.06)
                    RMusicTheme.accent
                        .frame(width: proxy.size.width * model.playback.progressFraction)
                }
            }
            .frame(height: 3)

            HStack(spacing: 11) {
                Button(action: onOpen) {
                    HStack(spacing: 11) {
                        if let track = model.playback.currentTrack {
                            ArtworkView(url: track.artworkURL, title: track.title, size: 50, cornerRadius: 10)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(track.title)
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(RMusicTheme.textPrimary)
                                    .lineLimit(1)
                                Text(track.artistsText)
                                    .font(.caption)
                                    .foregroundStyle(RMusicTheme.textSecondary)
                                    .lineLimit(1)
                            }
                        } else {
                            BrandMark(size: 48, showsGlow: false)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("选择一首歌")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(RMusicTheme.textPrimary)
                                Text("从搜索或歌单开始")
                                    .font(.caption)
                                    .foregroundStyle(RMusicTheme.textSecondary)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(RMusicPressStyle(pressedScale: 0.99))
                .disabled(model.playback.currentTrack == nil)

                Button {
                    model.playback.toggle()
                    RMusicHaptics.impact()
                } label: {
                    Group {
                        if model.playback.isBuffering {
                            ProgressView().tint(RMusicTheme.textPrimary)
                        } else {
                            Image(systemName: model.playback.isPlaying ? "pause.fill" : "play.fill")
                        }
                    }
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 44, height: 44)
                }
                .buttonStyle(RMusicPressStyle(pressedScale: 0.88))
                .disabled(model.playback.currentTrack == nil)
                .accessibilityLabel(model.playback.isPlaying ? "暂停" : "播放")

                Button {
                    model.playback.next()
                    RMusicHaptics.impact()
                } label: {
                    Image(systemName: "forward.end.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(RMusicPressStyle(pressedScale: 0.88))
                .disabled(model.playback.currentTrack == nil)
                .accessibilityLabel("下一首")
            }
            .padding(.horizontal, 10)
            .frame(height: 68)
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.white.opacity(0.10), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.25), radius: 18, y: 8)
        .accessibilityElement(children: .contain)
    }
}

extension PlaybackController {
    var progressFraction: Double {
        guard duration.isFinite, duration > 0 else { return 0 }
        return min(max(currentTime / duration, 0), 1)
    }
}
