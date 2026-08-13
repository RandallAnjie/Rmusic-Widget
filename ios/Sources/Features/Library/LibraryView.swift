import SwiftUI

struct LibraryView: View {
    @Environment(RMusicAppModel.self) private var model
    @State private var selectedSection: LibrarySection = .playlists
    @State private var confirmClearRecent = false

    var body: some View {
        @Bindable var model = model

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                header

                if !model.account.isAuthenticated {
                    signedOutCard
                } else {
                    sectionPicker

                    if let error = model.library.errorMessage {
                        ErrorBanner(message: error) {
                            Task { await model.library.refresh() }
                        }
                        .padding(.horizontal, 16)
                    }

                    sectionContent
                }
            }
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .navigationTitle("音乐库")
        .refreshable {
            guard model.account.isAuthenticated else { return }
            await model.library.refresh()
        }
        .sheet(isPresented: $model.showAddPlaylistSheet) {
            AddPlaylistView()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog("清空最近播放？", isPresented: $confirmClearRecent, titleVisibility: .visible) {
            Button("清空", role: .destructive) {
                Task {
                    await model.library.clearRecent()
                    RMusicHaptics.notification(.success)
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("这会移除当前 RMusic ID 的全部最近播放记录。")
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("你的音乐库")
                    .font(.largeTitle.weight(.bold))
                    .tracking(-0.8)
                Text("收藏、最近播放和云端歌单都在这里。")
                    .font(.subheadline)
                    .foregroundStyle(RMusicTheme.textSecondary)
            }
            Spacer()
            Button {
                model.requireAccount { model.showAddPlaylistSheet = true }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(RMusicTheme.accentInk)
                    .frame(width: 46, height: 46)
                    .background(RMusicTheme.accent, in: Circle())
            }
            .buttonStyle(RMusicPressStyle(pressedScale: 0.92))
            .accessibilityLabel("添加在线歌单")
        }
        .padding(.horizontal, 20)
    }

    private var signedOutCard: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .fill(RMusicTheme.violet.opacity(0.14))
                    .frame(width: 94, height: 94)
                Image(systemName: "person.badge.key.fill")
                    .font(.system(size: 42, weight: .semibold))
                    .foregroundStyle(RMusicTheme.accent)
            }
            Text("登录后同步你的音乐")
                .font(.title2.weight(.bold))
            Text("RMusic ID 不需要邮箱、手机号或密码。用设备密钥登录，即可跨设备读取收藏和歌单。")
                .font(.subheadline)
                .foregroundStyle(RMusicTheme.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                model.selectedTab = .account
            } label: {
                Text("前往登录")
                    .font(.headline)
                    .foregroundStyle(RMusicTheme.accentInk)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(RMusicTheme.accent, in: Capsule())
            }
            .buttonStyle(RMusicPressStyle())
        }
        .rmusicCard(padding: 24)
        .padding(.horizontal, 16)
    }

    private var sectionPicker: some View {
        Picker("音乐库分类", selection: $selectedSection) {
            ForEach(LibrarySection.allCases) { section in
                Text(section.title).tag(section)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch selectedSection {
        case .playlists: playlists
        case .favorites: tracks(model.library.favorites, emptyTitle: "还没有喜欢的歌曲", emptyMessage: "在任何歌曲旁轻点爱心，它就会出现在这里。")
        case .recent: recent
        }
    }

    @ViewBuilder
    private var playlists: some View {
        if model.library.isLoading && model.library.playlists.isEmpty {
            RMusicLoadingView(title: "正在同步云端歌单")
        } else if model.library.playlists.isEmpty {
            RMusicEmptyView(
                symbol: "music.note.list",
                title: "还没有保存歌单",
                message: "粘贴任一支持平台的分享链接或歌单 ID，RMusic 会自动识别来源。",
                actionTitle: "添加歌单"
            ) {
                model.showAddPlaylistSheet = true
            }
        } else {
            LazyVStack(spacing: 10) {
                ForEach(model.library.playlists) { playlist in
                    NavigationLink(value: CatalogRoute.playlist(source: playlist.source, id: playlist.id, title: playlist.title)) {
                        PlaylistRow(playlist: playlist)
                    }
                    .buttonStyle(RMusicPressStyle())
                    .contextMenu {
                        Button("更新歌单", systemImage: "arrow.clockwise") {
                            Task { await model.refreshPlaylist(playlist) }
                        }
                        Button("从音乐库移除", systemImage: "trash", role: .destructive) {
                            Task { await model.library.removePlaylist(playlist) }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func tracks(_ items: [Track], emptyTitle: String, emptyMessage: String) -> some View {
        Group {
            if items.isEmpty {
                RMusicEmptyView(symbol: "heart", title: emptyTitle, message: emptyMessage)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.stableID) { index, track in
                        TrackRow(
                            track: track,
                            index: index,
                            isCurrent: model.playback.currentTrack?.stableID == track.stableID,
                            isPlaying: model.playback.isPlaying,
                            isFavorite: model.library.isFavorite(track),
                            onPlay: { model.play(track, in: items) },
                            onFavorite: { model.toggleFavorite(track) },
                            onArtist: { model.openArtist(for: track) },
                            onAlbum: { model.openAlbum(for: track) }
                        )
                        .padding(.horizontal, 12)
                        if index < items.count - 1 {
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

    private var recent: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !model.library.recent.isEmpty {
                HStack {
                    Text("最近 \(model.library.recent.count) 首")
                        .font(.caption)
                        .foregroundStyle(RMusicTheme.textSecondary)
                    Spacer()
                    Button("清空", role: .destructive) { confirmClearRecent = true }
                        .font(.subheadline.weight(.semibold))
                }
                .padding(.horizontal, 20)
            }
            tracks(model.library.recent, emptyTitle: "还没有播放记录", emptyMessage: "开始播放后，最近听过的歌曲会在这里同步。")
        }
    }
}

private enum LibrarySection: String, CaseIterable, Identifiable {
    case playlists
    case favorites
    case recent

    var id: String { rawValue }
    var title: String {
        switch self {
        case .playlists: "歌单"
        case .favorites: "喜欢"
        case .recent: "最近"
        }
    }
}

private struct PlaylistRow: View {
    let playlist: PlaylistSummary

    var body: some View {
        HStack(spacing: 13) {
            ArtworkView(url: playlist.artworkURL, title: playlist.title, size: 64)
            VStack(alignment: .leading, spacing: 5) {
                Text(playlist.title)
                    .font(.body.weight(.bold))
                    .foregroundStyle(RMusicTheme.textPrimary)
                    .lineLimit(2)
                HStack(spacing: 5) {
                    Image(systemName: "icloud.fill")
                        .foregroundStyle(RMusicTheme.accent)
                    Text("\(playlist.source.displayName) · \(playlist.trackCount) 首")
                    if !playlist.creatorName.isEmpty {
                        Text("· \(playlist.creatorName)")
                    }
                }
                .font(.caption)
                .foregroundStyle(RMusicTheme.textSecondary)
                .lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(RMusicTheme.textTertiary)
        }
        .padding(12)
        .background(RMusicTheme.surface, in: RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous)
                .stroke(RMusicTheme.separator, lineWidth: 1)
        }
    }
}
