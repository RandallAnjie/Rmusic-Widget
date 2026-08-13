import SwiftUI

struct SearchView: View {
    @Environment(RMusicAppModel.self) private var model
    @State private var query = ""
    @State private var source: MusicSource = .aggregate
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                sourcePicker

                if let message = model.searchErrorMessage {
                    ErrorBanner(message: message) { performSearch(immediate: true) }
                        .padding(.horizontal, 16)
                }

                content
            }
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollIndicators(.hidden)
        .navigationTitle(query.isEmpty ? "搜索" : "“\(query)”")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "歌曲、歌手、专辑")
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .onSubmit(of: .search) { performSearch(immediate: true) }
        .onChange(of: query) { _, _ in performSearch(immediate: false) }
        .onChange(of: source) { _, _ in
            RMusicHaptics.selection()
            if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                performSearch(immediate: true)
            }
        }
        .onChange(of: model.pendingSearchQuery) { _, newValue in
            guard let newValue else { return }
            query = newValue
            model.pendingSearchQuery = nil
            if !newValue.isEmpty { performSearch(immediate: true) }
        }
        .onAppear {
            if let pending = model.pendingSearchQuery {
                query = pending
                model.pendingSearchQuery = nil
                if !pending.isEmpty { performSearch(immediate: true) }
            }
        }
    }

    private var sourcePicker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 9) {
                ForEach(MusicSource.allCases) { item in
                    Button {
                        source = item
                    } label: {
                        HStack(spacing: 7) {
                            if source == item {
                                Circle()
                                    .fill(RMusicTheme.accent)
                                    .frame(width: 6, height: 6)
                            }
                            Text(item.displayName)
                                .font(.subheadline.weight(.semibold))
                        }
                        .foregroundStyle(source == item ? RMusicTheme.accent : RMusicTheme.textSecondary)
                        .padding(.horizontal, 13)
                        .frame(height: 36)
                        .background(source == item ? RMusicTheme.accent.opacity(0.10) : RMusicTheme.surface, in: Capsule())
                        .overlay {
                            Capsule().stroke(source == item ? RMusicTheme.accent.opacity(0.44) : RMusicTheme.separator, lineWidth: 1)
                        }
                    }
                    .buttonStyle(RMusicPressStyle())
                }
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel("音乐平台")
    }

    @ViewBuilder
    private var content: some View {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            RMusicEmptyView(
                symbol: "waveform.badge.magnifyingglass",
                title: "找到下一首喜欢的歌",
                message: "默认会快速聚合多个音乐平台，也可以先选择指定平台。",
                actionTitle: "搜索 Lemon"
            ) {
                query = "Lemon"
                performSearch(immediate: true)
            }
        } else if model.isSearching && model.searchResults.isEmpty {
            RMusicLoadingView(title: "正在搜索 \(source.displayName)")
        } else if model.searchResults.isEmpty && !model.isSearching {
            RMusicEmptyView(
                symbol: "music.note.slash",
                title: "没有找到结果",
                message: "试试歌曲名、歌手名，或者切换到聚合搜索。"
            )
        } else {
            results
        }
    }

    private var results: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Button {
                    model.playAll(model.searchResults)
                } label: {
                    Image(systemName: "play.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(RMusicTheme.accentInk)
                        .frame(width: 44, height: 44)
                        .background(RMusicTheme.accent, in: Circle())
                }
                .buttonStyle(RMusicPressStyle(pressedScale: 0.92))
                .accessibilityLabel("播放全部")

                VStack(alignment: .leading, spacing: 2) {
                    Text("搜索结果")
                        .font(.title2.weight(.bold))
                    Text("\(model.searchResults.count) 首 · \(model.searchStatusText)")
                        .font(.caption)
                        .foregroundStyle(RMusicTheme.textSecondary)
                }
                Spacer()
                if model.isSearching {
                    ProgressView().tint(RMusicTheme.accent)
                }
            }
            .padding(.horizontal, 16)

            LazyVStack(spacing: 0) {
                ForEach(Array(model.searchResults.enumerated()), id: \.element.stableID) { index, track in
                    TrackRow(
                        track: track,
                        index: index,
                        isCurrent: model.playback.currentTrack?.stableID == track.stableID,
                        isPlaying: model.playback.isPlaying,
                        isFavorite: model.library.isFavorite(track),
                        onPlay: { model.play(track, in: model.searchResults) },
                        onFavorite: { model.requireAccount { model.toggleFavorite(track) } },
                        onArtist: { model.openArtist(for: track) },
                        onAlbum: { model.openAlbum(for: track) }
                    )
                    .padding(.horizontal, 12)

                    if index < model.searchResults.count - 1 {
                        Divider().overlay(RMusicTheme.separator).padding(.leading, 82)
                    }
                }
            }
            .padding(.vertical, 6)
            .background(RMusicTheme.surface, in: RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous))
            .padding(.horizontal, 10)
        }
    }

    private func performSearch(immediate: Bool) {
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            model.clearSearch()
            return
        }

        searchTask = Task {
            if !immediate {
                try? await Task.sleep(for: .milliseconds(420))
                guard !Task.isCancelled else { return }
            }
            await model.search(trimmed, source: source)
        }
    }
}

extension MusicSource: Identifiable {
    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .aggregate: "聚合"
        case .tencent: "QQ 音乐"
        case .netease: "网易云"
        case .kugou: "酷狗"
        case .soda: "汽水音乐"
        case .ytmusic: "YouTube Music"
        case .kuwo: "酷我"
        case .baidu: "百度"
        case .apple: "Apple Music"
        case .spotify: "Spotify"
        }
    }
}
