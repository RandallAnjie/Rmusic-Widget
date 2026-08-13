import Foundation
import Observation

@MainActor
@Observable
final class RMusicAppModel {
    let api: RMusicAPIClient
    let account: AccountStore
    let library: LibraryStore
    let playback: PlaybackController

    var selectedTab: RMusicTab = .home
    var isNowPlayingPresented = false
    var showAddPlaylistSheet = false
    var pendingSearchQuery: String?
    var catalogSheetRoute: CatalogRoute?
    var alertMessage: String?

    private(set) var discovery: DiscoveryPayload?
    private(set) var isHomeLoading = false
    private(set) var homeErrorMessage: String?
    private(set) var searchResults: [Track] = []
    private(set) var isSearching = false
    private(set) var searchErrorMessage: String?
    private(set) var searchMetadata = SearchMetadata()

    @ObservationIgnored private var didStart = false
    @ObservationIgnored private var searchGeneration = 0

    convenience init() {
        self.init(api: RMusicAPIClient.shared)
    }

    init(api: RMusicAPIClient) {
        self.api = api
        let account = AccountStore(api: api)
        let library = LibraryStore(api: api)
        self.account = account
        self.library = library
        playback = PlaybackController(
            apiClient: api,
            onRecentPlay: { track in
                guard account.isAuthenticated else { return }
                await library.addRecent(track)
            },
            preferences: UserDefaults(suiteName: NowPlayingSnapshotStore.appGroup) ?? .standard
        )
    }

    func start() async {
        guard !didStart else { return }
        didStart = true

        async let proxy: Void = bootstrapAnonymousSession()
        async let accountRestore: Void = account.restore()
        async let home: Void = loadDiscovery(refresh: false)
        _ = await (proxy, accountRestore, home)

        if account.isAuthenticated {
            await library.refresh()
        } else {
            library.reset()
        }
    }

    func loadDiscovery(refresh: Bool) async {
        guard !isHomeLoading else { return }
        isHomeLoading = true
        homeErrorMessage = nil
        defer { isHomeLoading = false }
        do {
            _ = try await api.bootstrapProxySession()
            discovery = try await api.discovery(refresh: refresh)
        } catch {
            homeErrorMessage = message(for: error)
        }
    }

    func search(_ query: String, source: MusicSource) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            clearSearch()
            return
        }
        searchGeneration += 1
        let generation = searchGeneration
        isSearching = true
        searchErrorMessage = nil
        do {
            _ = try await api.bootstrapProxySession()
            let result = try await api.search(query: trimmed, source: source)
            guard generation == searchGeneration, !Task.isCancelled else { return }
            searchResults = result.tracks
            searchMetadata = result.metadata
        } catch is CancellationError {
            return
        } catch {
            guard generation == searchGeneration else { return }
            searchErrorMessage = message(for: error)
        }
        if generation == searchGeneration { isSearching = false }
    }

    func clearSearch() {
        searchGeneration += 1
        searchResults = []
        searchMetadata = SearchMetadata()
        searchErrorMessage = nil
        isSearching = false
    }

    var searchStatusText: String {
        let successes = searchMetadata.sources.filter { $0.status.lowercased() == "success" }.count
        if !searchMetadata.complete { return successes > 0 ? "已返回 \(successes) 个平台，仍在补全" : "部分平台暂不可用" }
        if successes > 0 { return "来自 \(successes) 个平台" }
        return "聚合结果"
    }

    var discoveryStatusText: String {
        if isHomeLoading { return "正在刷新跨平台内容" }
        return homeErrorMessage == nil ? "已连接 music.bigrandall.io" : "部分内容暂不可用"
    }

    func play(_ track: Track, in tracks: [Track]) {
        requireAccount {
            playback.play(track: track, in: tracks)
            isNowPlayingPresented = true
        }
    }

    func playAll(_ tracks: [Track]) {
        guard let first = tracks.first else { return }
        play(first, in: tracks)
    }

    func toggleFavorite(_ track: Track) {
        Task {
            do {
                _ = try await library.toggleFavorite(track)
                RMusicHaptics.notification(.success)
            } catch {
                alertMessage = message(for: error)
                RMusicHaptics.notification(.error)
            }
        }
    }

    func requireAccount(_ action: () -> Void) {
        guard account.isAuthenticated else {
            alertMessage = "播放和同步音乐需要先使用设备密钥登录 RMusic ID。"
            selectedTab = .account
            return
        }
        action()
    }

    func openSearch(query: String = "") {
        pendingSearchQuery = query
        selectedTab = .search
    }

    func openArtist(for track: Track) {
        guard let artist = track.artists.first, let id = artist.catalogID(for: track.source) else {
            openSearch(query: track.artists.first?.name ?? track.artistsText)
            return
        }
        catalogSheetRoute = .artist(source: track.source, id: id)
    }

    func openAlbum(for track: Track) {
        guard let id = track.album?.id, !id.isEmpty else {
            openSearch(query: track.albumName)
            return
        }
        catalogSheetRoute = .album(source: track.source, id: id)
    }

    func loadCatalogPage(for route: CatalogRoute, refresh: Bool) async throws -> CatalogPage {
        switch route {
        case .album(let source, let id):
            return catalogPage(from: try await api.album(source: source, id: id))
        case .artist(let source, let id):
            return catalogPage(from: try await api.artist(source: source, id: id))
        case .playlist(let source, let id, let fallbackTitle):
            if !refresh,
               let saved = library.playlists.first(where: { $0.source == source && $0.id == id }),
               let snapshot = try? await library.loadPlaylist(saved) {
                return catalogPage(from: snapshot)
            }
            let snapshot = try await api.playlist(source: source, id: id, refresh: refresh)
            var page = catalogPage(from: snapshot)
            if page.title.isEmpty, let fallbackTitle, !fallbackTitle.isEmpty {
                page = CatalogPage(
                    source: page.source,
                    resourceID: page.resourceID,
                    kindTitle: page.kindTitle,
                    title: fallbackTitle,
                    subtitle: page.subtitle,
                    description: page.description,
                    artworkURL: page.artworkURL,
                    tracks: page.tracks,
                    releases: page.releases,
                    isSavable: page.isSavable,
                    isSaved: page.isSaved,
                    canRefresh: page.canRefresh
                )
            }
            return page
        }
    }

    func catalogPage(for route: CatalogRoute, refresh: Bool) async -> CatalogPage? {
        try? await loadCatalogPage(for: route, refresh: refresh)
    }

    func toggleSaved(_ page: CatalogPage) async {
        do {
            if let saved = library.playlists.first(where: { $0.source == page.source && $0.id == page.resourceID }) {
                await library.removePlaylist(saved)
            } else {
                let snapshot = PlaylistSnapshot(
                    source: page.source,
                    id: page.resourceID,
                    title: page.title,
                    cover: page.artworkURL?.absoluteString,
                    description: page.description,
                    tracks: page.tracks
                )
                _ = try await library.savePlaylist(snapshot)
            }
            RMusicHaptics.notification(.success)
        } catch {
            alertMessage = message(for: error)
            RMusicHaptics.notification(.error)
        }
    }

    func importPlaylist(_ input: String) async throws {
        guard let reference = PlaylistReferenceParser.parse(input) else {
            throw RMusicAppError.invalidPlaylist
        }
        let snapshot = try await api.playlist(source: reference.source, id: reference.id, refresh: true)
        _ = try await library.savePlaylist(snapshot)
    }

    func refreshPlaylist(_ playlist: PlaylistSummary) async {
        do {
            let snapshot = try await api.playlist(source: playlist.source, id: playlist.id, refresh: true)
            _ = try await library.savePlaylist(snapshot)
            RMusicHaptics.notification(.success)
        } catch {
            alertMessage = message(for: error)
            RMusicHaptics.notification(.error)
        }
    }

    func registerAccount(displayName: String) async throws {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        try await account.register(displayName: name.isEmpty ? "RMusic 用户" : name)
        await library.refresh()
    }

    func loginAccount() async throws {
        try await account.login()
        await library.refresh()
    }

    func addPasskey() async throws { try await account.addPasskey() }
    func updateDisplayName(_ name: String) async throws { try await account.updateDisplayName(name) }
    func removePasskey(_ device: PasskeyDevice) async throws { try await account.removeDevice(device) }
    func revokeSession(_ session: UserSession) async throws {
        try await account.revokeSession(session)
        if !account.isAuthenticated {
            playback.handleLogout()
            library.reset()
        }
    }

    func refreshAccount() async {
        await account.restore()
        if account.isAuthenticated { await library.refresh() }
    }

    func logout() async throws {
        playback.handleLogout()
        isNowPlayingPresented = false
        library.reset()
        await account.logout()
    }

    func handleDeepLink(_ url: URL) {
        if url.scheme?.lowercased() == "rmusic" {
            switch url.host?.lowercased() {
            case "now-playing":
                isNowPlayingPresented = playback.currentTrack != nil
                return
            case "playback":
                let action = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "action" })?.value
                switch action {
                case "previous": playback.previous()
                case "toggle": playback.toggle()
                case "next": playback.next()
                default: break
                }
                return
            default: break
            }
        }

        guard let deepLink = RMusicDeepLinkParser.parse(url) else { return }
        switch deepLink {
        case .home:
            selectedTab = .home
        case .search(let query, _):
            openSearch(query: query)
        case .playlist(let source, let id):
            catalogSheetRoute = .playlist(source: source, id: id, title: nil)
        case .album(let source, let id):
            catalogSheetRoute = .album(source: source, id: id)
        case .artist(let source, let id):
            catalogSheetRoute = .artist(source: source, id: id)
        }
    }

    func message(for error: Error) -> String {
        if let localized = error as? LocalizedError, let description = localized.errorDescription {
            return description
        }
        return error.localizedDescription
    }

    private func bootstrapAnonymousSession() async {
        do {
            _ = try await api.bootstrapProxySession()
        } catch {
            if homeErrorMessage == nil { homeErrorMessage = message(for: error) }
        }
    }

    private func catalogPage(from detail: CollectionDetail) -> CatalogPage {
        let subtitle = detail.creatorName.isEmpty
            ? [detail.releaseDate, detail.label].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            : detail.creatorName
        return CatalogPage(
            source: detail.source,
            resourceID: detail.id,
            kindTitle: title(for: detail.kind),
            title: detail.name,
            subtitle: subtitle,
            description: detail.description,
            artworkURL: detail.artworkURL,
            tracks: detail.tracks,
            releases: detail.albums.map {
                CatalogRelease(
                    source: $0.source,
                    id: $0.id,
                    title: $0.title,
                    subtitle: $0.releaseDate ?? $0.albumType ?? "专辑",
                    artworkURL: $0.artworkURL
                )
            },
            isSavable: detail.kind == .playlist,
            isSaved: library.playlists.contains { $0.source == detail.source && $0.id == detail.id },
            canRefresh: detail.kind == .playlist
        )
    }

    private func catalogPage(from snapshot: PlaylistSnapshot) -> CatalogPage {
        CatalogPage(
            source: snapshot.source,
            resourceID: snapshot.id,
            kindTitle: "歌单",
            title: snapshot.title,
            subtitle: snapshot.creatorName,
            description: snapshot.description,
            artworkURL: snapshot.artworkURL,
            tracks: snapshot.tracks,
            releases: [],
            isSavable: true,
            isSaved: library.playlists.contains { $0.source == snapshot.source && $0.id == snapshot.id },
            canRefresh: true
        )
    }

    private func title(for kind: CollectionKind) -> String {
        switch kind {
        case .album: "专辑"
        case .artist: "歌手"
        case .playlist: "歌单"
        }
    }
}

enum RMusicAppError: LocalizedError {
    case invalidPlaylist

    var errorDescription: String? {
        switch self {
        case .invalidPlaylist: "无法识别这个歌单链接或 ID。"
        }
    }
}
