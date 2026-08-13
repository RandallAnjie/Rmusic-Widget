import SwiftUI

struct HorizontalTrackSection: View {
    let title: String
    var subtitle: String? = nil
    let tracks: [Track]
    var onPlayAll: (() -> Void)? = nil
    let onPlay: (Track) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(
                title: title,
                subtitle: subtitle,
                actionTitle: onPlayAll == nil ? nil : "播放全部",
                action: onPlayAll
            )

            ScrollView(.horizontal) {
                LazyHStack(spacing: 14) {
                    ForEach(tracks) { track in
                        TrackCard(track: track) { onPlay(track) }
                            .scrollTransition(axis: .horizontal) { content, phase in
                                content
                                    .opacity(phase.isIdentity ? 1 : 0.72)
                                    .scaleEffect(phase.isIdentity ? 1 : 0.94)
                            }
                    }
                }
                .scrollTargetLayout()
                .padding(.horizontal, 20)
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned(limitBehavior: .always))
        }
    }
}
