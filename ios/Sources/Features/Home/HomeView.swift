import SwiftUI

struct HomeView: View {
    @Environment(RMusicAppModel.self) private var model

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 0..<5: return "夜深了，放点轻柔的"
        case 5..<12: return "早上好"
        case 12..<18: return "下午好"
        default: return "晚上好"
        }
    }

    var body: some View {
        @Bindable var model = model

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 34) {
                hero

                if let message = model.homeErrorMessage {
                    ErrorBanner(message: message) {
                        Task { await model.loadDiscovery(refresh: true) }
                    }
                    .padding(.horizontal, 20)
                }

                if model.isHomeLoading && model.discovery == nil {
                    RMusicLoadingView(title: "正在汇集今日音乐")
                } else if let discovery = model.discovery {
                    HorizontalTrackSection(
                        title: "为你推荐",
                        subtitle: "跨平台精选",
                        tracks: discovery.recommendations,
                        onPlay: { model.play($0, in: discovery.recommendations) }
                    )

                    HorizontalTrackSection(
                        title: "热门榜单",
                        tracks: discovery.charts,
                        onPlayAll: { model.playAll(discovery.charts) },
                        onPlay: { model.play($0, in: discovery.charts) }
                    )

                    HorizontalTrackSection(
                        title: "新歌速递",
                        tracks: discovery.newReleases,
                        onPlayAll: { model.playAll(discovery.newReleases) },
                        onPlay: { model.play($0, in: discovery.newReleases) }
                    )
                }

                if !model.library.recent.isEmpty {
                    HorizontalTrackSection(
                        title: "最近播放",
                        tracks: Array(model.library.recent.prefix(12)),
                        onPlay: { model.play($0, in: model.library.recent) }
                    )
                }

                moodSection

                if !model.library.favorites.isEmpty {
                    favoritesPreview
                }

                discoveryFooter
            }
            .padding(.vertical, 18)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .navigationTitle("首页")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                HStack(spacing: 9) {
                    BrandMark(size: 34)
                    Text("RMusic")
                        .font(.headline.weight(.bold))
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.loadDiscovery(refresh: true) }
                } label: {
                    Group {
                        if model.isHomeLoading {
                            ProgressView()
                                .tint(RMusicTheme.accent)
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .frame(width: 40, height: 40)
                }
                .disabled(model.isHomeLoading)
                .accessibilityLabel("刷新首页")
            }
        }
        .sheet(isPresented: $model.showAddPlaylistSheet) {
            AddPlaylistView()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
        }
        .refreshable { await model.loadDiscovery(refresh: true) }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(greeting.uppercased())
                .font(.caption.weight(.bold))
                .tracking(1.2)
                .foregroundStyle(RMusicTheme.accent)

            Text("想听的，\n现在就响起。")
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .tracking(-1.1)
                .lineSpacing(-2)
                .fixedSize(horizontal: false, vertical: true)

            Text("从多个音乐平台发现、收藏并连续播放你的下一首歌。")
                .font(.subheadline)
                .foregroundStyle(RMusicTheme.textSecondary)
                .frame(maxWidth: 420, alignment: .leading)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { heroButtons }
                VStack(spacing: 12) { heroButtons }
            }

            currentTrackCard
        }
        .padding(22)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: RMusicTheme.largeRadius, style: .continuous)
                    .fill(RMusicTheme.surface)
                RadialGradient(
                    colors: [RMusicTheme.accent.opacity(0.18), .clear],
                    center: .topTrailing,
                    startRadius: 0,
                    endRadius: 280
                )
                RoundedRectangle(cornerRadius: RMusicTheme.largeRadius, style: .continuous)
                    .stroke(RMusicTheme.separator, lineWidth: 1)
            }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var heroButtons: some View {
        Button {
            model.openSearch()
        } label: {
            Label("开始搜索", systemImage: "magnifyingglass")
                .font(.headline)
                .foregroundStyle(RMusicTheme.accentInk)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(RMusicTheme.accent, in: Capsule())
        }
        .buttonStyle(RMusicPressStyle())

        Button {
            model.requireAccount {
                model.showAddPlaylistSheet = true
            }
        } label: {
            Label("添加歌单", systemImage: "plus")
                .font(.headline)
                .foregroundStyle(RMusicTheme.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(.white.opacity(0.08), in: Capsule())
                .overlay { Capsule().stroke(.white.opacity(0.12), lineWidth: 1) }
        }
        .buttonStyle(RMusicPressStyle())
    }

    private var currentTrackCard: some View {
        Button {
            if model.playback.currentTrack != nil {
                model.isNowPlayingPresented = true
            } else {
                model.openSearch()
            }
        } label: {
            HStack(spacing: 12) {
                if let track = model.playback.currentTrack {
                    ArtworkView(url: track.artworkURL, title: track.title, size: 48)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.playback.isPlaying ? "正在播放" : "继续播放")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(RMusicTheme.accent)
                        Text(track.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                    }
                } else {
                    BrandMark(size: 46, showsGlow: false)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("播放器已准备好")
                            .font(.subheadline.weight(.semibold))
                        Text("从搜索或歌单开始")
                            .font(.caption)
                            .foregroundStyle(RMusicTheme.textSecondary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(RMusicTheme.textSecondary)
            }
            .padding(12)
            .background(.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
        .buttonStyle(RMusicPressStyle())
    }

    private var moodSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "按心情探索")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                MoodCard(title: "华语流行", subtitle: "熟悉的旋律", symbol: "music.note", colors: [Color(red: 0.08, green: 0.47, blue: 0.36), Color(red: 0.12, green: 0.60, blue: 0.40)]) {
                    model.openSearch(query: "华语流行")
                }
                MoodCard(title: "欧美流行", subtitle: "世界正流行", symbol: "globe.americas.fill", colors: [Color(red: 0.38, green: 0.25, blue: 0.60), Color(red: 0.55, green: 0.33, blue: 0.79)]) {
                    model.openSearch(query: "欧美流行")
                }
                MoodCard(title: "日语精选", subtitle: "发现新声音", symbol: "sparkles", colors: [Color(red: 0.74, green: 0.30, blue: 0.21), Color(red: 0.88, green: 0.48, blue: 0.24)]) {
                    model.openSearch(query: "日语精选")
                }
                MoodCard(title: "轻音乐", subtitle: "让思绪慢下来", symbol: "wind", colors: [Color(red: 0.14, green: 0.38, blue: 0.64), Color(red: 0.20, green: 0.52, blue: 0.77)]) {
                    model.openSearch(query: "轻音乐")
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private var favoritesPreview: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "喜欢的歌曲", actionTitle: "查看全部") {
                model.selectedTab = .library
            }
            VStack(spacing: 0) {
                ForEach(Array(model.library.favorites.prefix(5).enumerated()), id: \.element.id) { index, track in
                    TrackRow(
                        track: track,
                        index: index,
                        isCurrent: model.playback.currentTrack?.stableID == track.stableID,
                        isPlaying: model.playback.isPlaying,
                        isFavorite: true,
                        onPlay: { model.play(track, in: model.library.favorites) },
                        onFavorite: { model.toggleFavorite(track) }
                    )
                    if index < min(model.library.favorites.count, 5) - 1 {
                        Divider().overlay(RMusicTheme.separator).padding(.leading, 84)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(RMusicTheme.surface, in: RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous))
            .padding(.horizontal, 16)
        }
    }

    private var discoveryFooter: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(RMusicTheme.accent)
            Text(model.discoveryStatusText)
                .font(.caption)
                .foregroundStyle(RMusicTheme.textSecondary)
            Spacer()
        }
        .padding(.horizontal, 20)
    }
}

private struct MoodCard: View {
    let title: String
    let subtitle: String
    let symbol: String
    let colors: [Color]
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous)
                    .fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: symbol)
                    .font(.system(size: 64, weight: .black))
                    .foregroundStyle(.white.opacity(0.15))
                    .rotationEffect(.degrees(-12))
                    .offset(x: 74, y: -20)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline.weight(.bold))
                    Text(subtitle).font(.caption).opacity(0.78)
                }
                .foregroundStyle(.white)
                .padding(16)
            }
            .frame(minHeight: 118)
            .contentShape(RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous))
        }
        .buttonStyle(RMusicPressStyle())
    }
}
