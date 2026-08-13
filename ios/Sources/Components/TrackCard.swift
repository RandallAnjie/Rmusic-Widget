import SwiftUI

struct TrackCard: View {
    let track: Track
    var width: CGFloat = 146
    var onPlay: () -> Void

    var body: some View {
        Button(action: onPlay) {
            VStack(alignment: .leading, spacing: 9) {
                ArtworkView(url: track.artworkURL, title: track.title, size: width)
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(RMusicTheme.accentInk)
                            .frame(width: 38, height: 38)
                            .background(RMusicTheme.accent, in: Circle())
                            .shadow(color: .black.opacity(0.35), radius: 10, y: 5)
                            .padding(8)
                    }

                Text(track.title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(RMusicTheme.textPrimary)
                    .lineLimit(1)

                Text(track.artistsText)
                    .font(.caption)
                    .foregroundStyle(RMusicTheme.textSecondary)
                    .lineLimit(1)
            }
            .frame(width: width, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(RMusicPressStyle())
        .accessibilityLabel("播放 \(track.title)，\(track.artistsText)")
    }
}
