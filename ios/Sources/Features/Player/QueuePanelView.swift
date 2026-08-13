import SwiftUI

struct QueuePanelView: View {
    @Environment(RMusicAppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("播放队列")
                        .font(.title3.weight(.bold))
                    Text("\(model.playback.queue.count) 首")
                        .font(.caption)
                        .foregroundStyle(RMusicTheme.textSecondary)
                }
                Spacer()
                if model.playback.queue.count > 1 {
                    Button("清空接下来") {
                        model.playback.clearUpcoming()
                        RMusicHaptics.notification(.success)
                    }
                    .font(.caption.weight(.bold))
                    .foregroundStyle(RMusicTheme.accent)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)

            if model.playback.queue.isEmpty {
                RMusicEmptyView(symbol: "list.bullet", title: "队列是空的", message: "从搜索结果或歌单开始播放。")
            } else {
                ScrollViewReader { reader in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(model.playback.queue.enumerated()), id: \.element.stableID) { index, track in
                                TrackRow(
                                    track: track,
                                    index: index,
                                    isCurrent: index == model.playback.queueIndex,
                                    isPlaying: model.playback.isPlaying,
                                    isFavorite: model.library.isFavorite(track),
                                    onPlay: {
                                        model.playback.playQueueItem(at: index)
                                        RMusicHaptics.selection()
                                    },
                                    onFavorite: { model.requireAccount { model.toggleFavorite(track) } }
                                )
                                .padding(.horizontal, 10)
                                .id(index)
                                if index < model.playback.queue.count - 1 {
                                    Divider().overlay(RMusicTheme.separator).padding(.leading, 82)
                                }
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                    .onAppear { reader.scrollTo(model.playback.queueIndex, anchor: .center) }
                    .onChange(of: model.playback.queueIndex) { _, index in
                        withAnimation(RMusicTheme.responsiveSpring) { reader.scrollTo(index, anchor: .center) }
                    }
                }
            }
        }
        .background(.black.opacity(0.12), in: RoundedRectangle(cornerRadius: RMusicTheme.largeRadius, style: .continuous))
    }
}
