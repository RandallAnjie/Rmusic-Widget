import SwiftUI

struct CatalogDetailView: View {
    let route: CatalogRoute
    @Environment(RMusicAppModel.self) private var model
    @State private var page: CatalogPage?
    @State private var isLoading = true
    @State private var isRefreshing = false
    @State private var errorMessage: String?
    @State private var descriptionExpanded = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if isLoading && page == nil {
                    RMusicLoadingView(title: "正在加载音乐目录")
                        .padding(.top, 80)
                } else if let errorMessage, page == nil {
                    RMusicEmptyView(symbol: "exclamationmark.icloud", title: "加载失败", message: errorMessage, actionTitle: "重试") {
                        Task { await load(refresh: false) }
                    }
                    .padding(.top, 60)
                } else if let page {
                    hero(page)

                    if let errorMessage {
                        ErrorBanner(message: errorMessage) { Task { await load(refresh: false) } }
                            .padding(.horizontal, 16)
                    }

                    if !page.releases.isEmpty {
                        releases(page)
                    }

                    trackList(page)
                }
            }
            .padding(.vertical, 16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .navigationTitle(page?.kindTitle ?? "音乐目录")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if page?.canRefresh == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await load(refresh: true) }
                    } label: {
                        if isRefreshing { ProgressView().tint(RMusicTheme.accent) }
                        else { Image(systemName: "arrow.clockwise") }
                    }
                    .disabled(isRefreshing)
                    .accessibilityLabel("更新歌单")
                }
            }
        }
        .task(id: route) { await load(refresh: false) }
        .refreshable { await load(refresh: page?.canRefresh == true) }
    }

    private func hero(_ page: CatalogPage) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 18) {
                    heroArtwork(page)
                    heroMetadata(page)
                }
                VStack(alignment: .leading, spacing: 16) {
                    heroArtwork(page)
                    heroMetadata(page)
                }
            }

            if !page.description.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    Text(page.description)
                        .font(.subheadline)
                        .foregroundStyle(RMusicTheme.textSecondary)
                        .lineLimit(descriptionExpanded ? nil : 2)
                    Button(descriptionExpanded ? "收起" : "更多") {
                        withAnimation(RMusicTheme.responsiveSpring) { descriptionExpanded.toggle() }
                    }
                    .font(.caption.weight(.bold))
                    .foregroundStyle(RMusicTheme.accent)
                }
            }

            HStack(spacing: 12) {
                Button {
                    model.playAll(page.tracks)
                } label: {
                    Label("播放", systemImage: "play.fill")
                        .font(.headline)
                        .foregroundStyle(RMusicTheme.accentInk)
                        .padding(.horizontal, 22)
                        .frame(height: 48)
                        .background(RMusicTheme.accent, in: Capsule())
                }
                .buttonStyle(RMusicPressStyle())
                .disabled(page.tracks.isEmpty)

                if page.isSavable {
                    Button {
                        model.requireAccount {
                            Task {
                                await model.toggleSaved(page)
                                self.page = await model.catalogPage(for: route, refresh: false)
                            }
                        }
                    } label: {
                        Label(page.isSaved ? "已保存" : "保存", systemImage: page.isSaved ? "heart.fill" : "heart")
                            .font(.headline)
                            .foregroundStyle(page.isSaved ? RMusicTheme.accent : RMusicTheme.textPrimary)
                            .padding(.horizontal, 18)
                            .frame(height: 48)
                            .background(.white.opacity(0.08), in: Capsule())
                            .overlay { Capsule().stroke(RMusicTheme.separator, lineWidth: 1) }
                    }
                    .buttonStyle(RMusicPressStyle())
                }

                if isRefreshing { ProgressView().tint(RMusicTheme.accent) }
            }
        }
        .padding(20)
        .background {
            RoundedRectangle(cornerRadius: RMusicTheme.largeRadius, style: .continuous)
                .fill(RMusicTheme.surface)
                .overlay {
                    RadialGradient(colors: [RMusicTheme.accent.opacity(0.12), .clear], center: .topTrailing, startRadius: 0, endRadius: 280)
                        .clipShape(RoundedRectangle(cornerRadius: RMusicTheme.largeRadius, style: .continuous))
                }
        }
        .padding(.horizontal, 16)
    }

    private func heroArtwork(_ page: CatalogPage) -> some View {
        ArtworkView(url: page.artworkURL, title: page.title, size: 124, cornerRadius: 18)
            .shadow(color: .black.opacity(0.34), radius: 22, y: 10)
    }

    private func heroMetadata(_ page: CatalogPage) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("\(page.source.displayName) · \(page.kindTitle)".uppercased())
                .font(.caption.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(RMusicTheme.accent)
            Text(page.title)
                .font(.title.weight(.bold))
                .tracking(-0.6)
                .fixedSize(horizontal: false, vertical: true)
            if !page.subtitle.isEmpty {
                Text(page.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(RMusicTheme.textSecondary)
            }
            Text("\(page.tracks.count) 首歌曲")
                .font(.caption)
                .foregroundStyle(RMusicTheme.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func releases(_ page: CatalogPage) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "发行作品")
            ScrollView(.horizontal) {
                LazyHStack(spacing: 14) {
                    ForEach(page.releases) { release in
                        NavigationLink(value: CatalogRoute.album(source: release.source, id: release.id)) {
                            VStack(alignment: .leading, spacing: 8) {
                                ArtworkView(url: release.artworkURL, title: release.title, size: 142)
                                Text(release.title)
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(RMusicTheme.textPrimary)
                                    .lineLimit(1)
                                Text(release.subtitle)
                                    .font(.caption)
                                    .foregroundStyle(RMusicTheme.textSecondary)
                                    .lineLimit(1)
                            }
                            .frame(width: 142, alignment: .leading)
                        }
                        .buttonStyle(RMusicPressStyle())
                    }
                }
                .padding(.horizontal, 20)
            }
            .scrollIndicators(.hidden)
        }
    }

    private func trackList(_ page: CatalogPage) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(
                title: page.kindTitle == "歌手" ? "代表作" : "曲目",
                actionTitle: page.tracks.isEmpty ? nil : "播放全部"
            ) {
                model.playAll(page.tracks)
            }

            if page.tracks.isEmpty {
                RMusicEmptyView(symbol: "music.note.slash", title: "暂无曲目", message: "这个目录暂时没有可显示的歌曲。")
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(page.tracks.enumerated()), id: \.element.stableID) { index, track in
                        TrackRow(
                            track: track,
                            index: index,
                            isCurrent: model.playback.currentTrack?.stableID == track.stableID,
                            isPlaying: model.playback.isPlaying,
                            isFavorite: model.library.isFavorite(track),
                            onPlay: { model.play(track, in: page.tracks) },
                            onFavorite: { model.requireAccount { model.toggleFavorite(track) } },
                            onArtist: { model.openArtist(for: track) },
                            onAlbum: { model.openAlbum(for: track) }
                        )
                        .padding(.horizontal, 12)
                        if index < page.tracks.count - 1 {
                            Divider().overlay(RMusicTheme.separator).padding(.leading, 82)
                        }
                    }
                }
                .padding(.vertical, 6)
                .background(RMusicTheme.surface, in: RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous))
                .padding(.horizontal, 10)
            }
        }
    }

    private func load(refresh: Bool) async {
        if refresh { isRefreshing = true } else if page == nil { isLoading = true }
        errorMessage = nil
        do {
            page = try await model.loadCatalogPage(for: route, refresh: refresh)
        } catch {
            errorMessage = model.message(for: error)
        }
        isLoading = false
        isRefreshing = false
    }
}

struct CatalogPage: Sendable {
    let source: MusicSource
    let resourceID: String
    let kindTitle: String
    let title: String
    let subtitle: String
    let description: String
    let artworkURL: URL?
    let tracks: [Track]
    let releases: [CatalogRelease]
    let isSavable: Bool
    var isSaved: Bool
    let canRefresh: Bool
}

struct CatalogRelease: Identifiable, Hashable, Sendable {
    let source: MusicSource
    let id: String
    let title: String
    let subtitle: String
    let artworkURL: URL?
}
