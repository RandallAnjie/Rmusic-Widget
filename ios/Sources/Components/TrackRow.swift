import SwiftUI

struct TrackRow: View {
    let track: Track
    var index: Int? = nil
    var isCurrent = false
    var isPlaying = false
    var isFavorite = false
    var onPlay: () -> Void
    var onFavorite: (() -> Void)? = nil
    var onArtist: (() -> Void)? = nil
    var onAlbum: (() -> Void)? = nil

    var body: some View {
        Button(action: onPlay) {
            HStack(spacing: 12) {
                if let index {
                    Group {
                        if isCurrent {
                            EqualizerGlyph(isAnimating: isPlaying)
                        } else {
                            Text(String(index + 1))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(RMusicTheme.textTertiary)
                        }
                    }
                    .frame(width: 24)
                }

                ArtworkView(url: track.artworkURL, title: track.title, size: 48)

                VStack(alignment: .leading, spacing: 4) {
                    Text(track.title)
                        .font(.body.weight(isCurrent ? .bold : .semibold))
                        .foregroundStyle(isCurrent ? RMusicTheme.accent : RMusicTheme.textPrimary)
                        .lineLimit(1)

                    HStack(spacing: 5) {
                        if track.playback?.previewOnly == true {
                            Text("试听")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(RMusicTheme.accentInk)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(RMusicTheme.accent, in: Capsule())
                        }
                        Text(track.artistsText)
                            .lineLimit(1)
                        if !track.albumName.isEmpty {
                            Text("·")
                            Text(track.albumName)
                                .lineLimit(1)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(RMusicTheme.textSecondary)
                }

                Spacer(minLength: 4)

                if let onFavorite {
                    Button(action: onFavorite) {
                        Image(systemName: isFavorite ? "heart.fill" : "heart")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(isFavorite ? RMusicTheme.accent : RMusicTheme.textSecondary)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(RMusicPressStyle(pressedScale: 0.9))
                    .accessibilityLabel(isFavorite ? "取消喜欢" : "喜欢")
                }
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(RMusicPressStyle(pressedScale: 0.985))
        .contextMenu {
            if let onArtist {
                Button("查看歌手", systemImage: "person.wave.2", action: onArtist)
            }
            if let onAlbum, !track.albumName.isEmpty {
                Button("查看专辑", systemImage: "square.stack", action: onAlbum)
            }
            if let onFavorite {
                Button(isFavorite ? "取消喜欢" : "添加到喜欢", systemImage: isFavorite ? "heart.slash" : "heart", action: onFavorite)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(track.title)，\(track.artistsText)")
        .accessibilityHint("轻点播放")
    }
}

private struct EqualizerGlyph: View {
    let isAnimating: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = false

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            bar(phase ? 8 : 14)
            bar(phase ? 15 : 7)
            bar(phase ? 10 : 16)
        }
        .frame(width: 20, height: 20)
        .foregroundStyle(RMusicTheme.accent)
        .onAppear { updateAnimation() }
        .onChange(of: isAnimating) { _, _ in updateAnimation() }
    }

    private func bar(_ height: CGFloat) -> some View {
        Capsule().frame(width: 3, height: isAnimating ? height : 5)
    }

    private func updateAnimation() {
        guard isAnimating, !reduceMotion else {
            phase = false
            return
        }
        withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) {
            phase = true
        }
    }
}
