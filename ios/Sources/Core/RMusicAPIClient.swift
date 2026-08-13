import Foundation
import Observation

enum RMusicAPIError: LocalizedError, Equatable {
    case invalidURL(String)
    case invalidResponse
    case decoding(String)
    case http(status: Int, problem: APIProblem?)
    case authenticationRequired(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "RMusic 服务地址无效。"
        case .invalidResponse:
            "服务器返回了无法识别的响应。"
        case .decoding(let detail):
            "服务器数据格式异常：\(detail)"
        case .http(let status, let problem):
            problem?.detail ?? problem?.title ?? "请求失败（\(status)）"
        case .authenticationRequired(let detail):
            detail
        case .transport(let detail):
            "网络连接失败：\(detail)"
        }
    }

    var statusCode: Int? {
        switch self {
        case .http(let status, _): status
        case .authenticationRequired: 401
        default: nil
        }
    }
}

@MainActor
@Observable
final class RMusicAPIClient {
    static let shared = RMusicAPIClient()

    let baseURL: URL
    private(set) var proxySession: ProxySessionStatus?
    private(set) var hasBearerToken: Bool

    private let session: URLSession
    private let tokenStore: BearerTokenStoring
    private var bearerToken: String?
    private var bootstrapTask: Task<ProxySessionStatus, Error>?
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(
        baseURL: URL = RMusicService.baseURL,
        session: URLSession? = nil,
        tokenStore: BearerTokenStoring = KeychainBearerTokenStore()
    ) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        let storedToken = try? tokenStore.readToken()
        bearerToken = storedToken
        hasBearerToken = storedToken != nil

        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.default
            configuration.httpCookieStorage = .shared
            configuration.httpShouldSetCookies = true
            configuration.requestCachePolicy = .useProtocolCachePolicy
            configuration.timeoutIntervalForRequest = 30
            configuration.timeoutIntervalForResource = 120
            configuration.waitsForConnectivity = true
            self.session = URLSession(configuration: configuration)
        }
    }

    func makeURL(path: String, queryItems: [URLQueryItem] = []) throws -> URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw RMusicAPIError.invalidURL(path)
        }
        let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
        components.percentEncodedPath = normalizedPath
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else { throw RMusicAPIError.invalidURL(path) }
        return url
    }

    func bootstrapProxySession(force: Bool = false) async throws -> ProxySessionStatus {
        if !force, let proxySession, proxySession.refreshAfter > Date() {
            return proxySession
        }
        if let bootstrapTask { return try await bootstrapTask.value }

        let task = Task { [self] in
            let data = try await sendData(
                method: "POST",
                path: "/api/proxy/session",
                body: nil,
                retryProxyAuthentication: false
            )
            let status: ProxySessionStatus = try decode(ProxySessionStatus.self, from: data)
            proxySession = status
            return status
        }
        bootstrapTask = task
        defer { bootstrapTask = nil }
        return try await task.value
    }

    func discovery(refresh: Bool = false) async throws -> DiscoveryPayload {
        var query = [
            URLQueryItem(name: "source", value: "netease,tencent"),
            URLQueryItem(name: "limit", value: "8"),
            URLQueryItem(name: "view", value: "compact")
        ]
        if refresh { query.append(URLQueryItem(name: "refresh", value: "true")) }
        return try await proxyEnvelope(path: "/api/proxy/v2/discovery", queryItems: query)
    }

    func search(query: String, source: MusicSource = .aggregate) async throws -> SearchResult {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return SearchResult(tracks: [], metadata: SearchMetadata()) }
        var queryItems = [
            URLQueryItem(name: "query", value: trimmed),
            URLQueryItem(name: "source", value: source == .aggregate ? "all" : source.rawValue),
            URLQueryItem(name: "limit", value: "80"),
            URLQueryItem(name: "view", value: "compact")
        ]
        if source == .aggregate { queryItems.append(URLQueryItem(name: "mode", value: "fast")) }

        let data = try await sendData(method: "GET", path: "/api/proxy/v2/tracks", queryItems: queryItems)
        let envelope: APIEnvelope<[Track]> = try decode(APIEnvelope<[Track]>.self, from: data)
        let metadata = SearchMetadata(
            complete: envelope.meta?.complete ?? true,
            total: envelope.meta?.total,
            sources: envelope.meta?.sources ?? []
        )
        return SearchResult(tracks: envelope.data, metadata: metadata)
    }

    func album(source: MusicSource, id: String) async throws -> CollectionDetail {
        try await collection(kind: .album, source: source, id: id, pageSize: 100)
    }

    func artist(source: MusicSource, id: String) async throws -> CollectionDetail {
        var detail = try await collection(kind: .artist, source: source, id: id, pageSize: 50)
        detail.albums = (try? await artistAlbums(source: source, id: id)) ?? []
        return detail
    }

    func artistAlbums(source: MusicSource, id: String, limit: Int = 100) async throws -> [Album] {
        let path = "/api/proxy/v2/artists/\(Self.pathComponent(source.rawValue))/\(Self.pathComponent(id))/albums"
        return try await proxyEnvelope(path: path, queryItems: [
            URLQueryItem(name: "offset", value: "0"),
            URLQueryItem(name: "limit", value: String(max(1, min(limit, 500)))),
            URLQueryItem(name: "view", value: "compact")
        ])
    }

    func playlist(source: MusicSource, id: String, refresh: Bool = false) async throws -> PlaylistSnapshot {
        let detail = try await collection(
            kind: .playlist,
            source: source,
            id: id,
            pageSize: 100,
            refresh: refresh
        )
        return PlaylistSnapshot(
            source: detail.source,
            id: detail.id,
            title: detail.name,
            cover: detail.cover ?? detail.artwork?.url,
            description: detail.description,
            creator: detail.creator,
            stats: CollectionStats(
                trackCount: detail.tracks.count,
                playCount: detail.stats.playCount,
                followerCount: detail.stats.followerCount
            ),
            tracks: detail.tracks
        )
    }

    func lyrics(for track: Track, wordSynced: Bool = true) async throws -> String {
        if let url = track.lyricsURL(wordLevel: wordSynced) {
            return try await lyrics(from: url)
        }
        let path = "/api/proxy/v2/lyrics/\(Self.pathComponent(track.source.rawValue))/\(Self.pathComponent(track.id))"
        let query = wordSynced ? [URLQueryItem(name: "granularity", value: "word")] : []
        let data = try await sendData(method: "GET", path: path, queryItems: query, accept: "text/plain")
        guard let value = String(data: data, encoding: .utf8) else {
            throw RMusicAPIError.decoding("歌词不是 UTF-8 文本")
        }
        return value
    }

    func lyrics(from url: URL) async throws -> String {
        let data = try await sendData(method: "GET", url: url, accept: "text/plain")
        guard let value = String(data: data, encoding: .utf8) else {
            throw RMusicAPIError.decoding("歌词不是 UTF-8 文本")
        }
        return value
    }

    func streamURL(for track: Track, quality: PlaybackQuality = .auto) -> URL? {
        let direct = RMusicURL.resolve(track.links.stream, relativeTo: baseURL)
        let fallback = try? makeURL(
            path: "/api/proxy/v2/streams/\(Self.pathComponent(track.source.rawValue))/\(Self.pathComponent(track.id))"
        )
        guard let url = direct ?? fallback,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return direct ?? fallback }
        var items = components.queryItems ?? []
        items.removeAll { $0.name == "quality" }
        items.append(URLQueryItem(name: "quality", value: quality.rawValue))
        components.queryItems = items
        return components.url
    }

    func artworkURL(for track: Track) -> URL? {
        track.artworkURL ?? (try? makeURL(
            path: "/api/proxy/v2/artworks/\(Self.pathComponent(track.source.rawValue))/\(Self.pathComponent(track.id))"
        ))
    }

    func authorizedRequest(for url: URL, range: String? = nil) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        // Never forward the RMusic bearer to provider-owned artwork or other
        // external links that may appear in a tolerant catalog payload.
        if isRMusicServiceURL(url) {
            request.setValue(RMusicService.clientIdentifier, forHTTPHeaderField: "X-RMusic-Client")
            if let bearerToken {
                request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
            }
        }
        if let range { request.setValue(range, forHTTPHeaderField: "Range") }
        return request
    }

    func data(from url: URL) async throws -> Data {
        try await sendData(method: "GET", url: url, accept: "*/*")
    }

    // MARK: - Account endpoints

    func accountStatus() async throws -> AccountStatus {
        try await json(method: "GET", path: "/api/auth/session")
    }

    func registrationOptions(displayName: String) async throws -> PasskeyRegistrationOptions {
        try await json(
            method: "POST",
            path: "/api/auth/register/options",
            body: ["displayName": displayName]
        )
    }

    func addDeviceOptions() async throws -> PasskeyRegistrationOptions {
        try await json(method: "POST", path: "/api/auth/devices/options", body: EmptyBody())
    }

    func loginOptions() async throws -> PasskeyAuthenticationOptions {
        try await json(method: "POST", path: "/api/auth/login/options", body: EmptyBody())
    }

    func verifyRegistration(
        flowID: String,
        credential: PasskeyCredentialPayload,
        deviceName: String
    ) async throws -> AccountStatus {
        let body = PasskeyVerificationBody(
            flowId: flowID,
            response: credential,
            sessionMode: "bearer",
            deviceName: deviceName
        )
        let status: AccountStatus = try await json(
            method: "POST",
            path: "/api/auth/register/verify",
            body: body
        )
        try persistAccessToken(from: status)
        return status
    }

    func verifyLogin(
        flowID: String,
        credential: PasskeyCredentialPayload,
        deviceName: String
    ) async throws -> AccountStatus {
        let body = PasskeyVerificationBody(
            flowId: flowID,
            response: credential,
            sessionMode: "bearer",
            deviceName: deviceName
        )
        let status: AccountStatus = try await json(
            method: "POST",
            path: "/api/auth/login/verify",
            body: body
        )
        try persistAccessToken(from: status)
        return status
    }

    func verifyAddedDevice(
        flowID: String,
        credential: PasskeyCredentialPayload,
        deviceName: String
    ) async throws -> AddedDevicePayload {
        try await json(
            method: "POST",
            path: "/api/auth/devices/verify",
            body: PasskeyVerificationBody(
                flowId: flowID,
                response: credential,
                sessionMode: nil,
                deviceName: deviceName
            )
        )
    }

    func updateProfile(displayName: String) async throws -> AccountUser {
        let payload: UserPayload = try await json(
            method: "PATCH",
            path: "/api/auth/profile",
            body: ["displayName": displayName]
        )
        return payload.user
    }

    func devices() async throws -> [PasskeyDevice] {
        let payload: DevicesPayload = try await json(method: "GET", path: "/api/auth/devices")
        return payload.devices
    }

    func removeDevice(id: String) async throws {
        _ = try await sendData(
            method: "DELETE",
            path: "/api/auth/devices/\(Self.pathComponent(id))"
        )
    }

    func sessions() async throws -> [UserSession] {
        let payload: SessionsPayload = try await json(method: "GET", path: "/api/auth/sessions")
        return payload.sessions
    }

    func revokeSession(id: String) async throws {
        _ = try await sendData(
            method: "DELETE",
            path: "/api/auth/sessions/\(Self.pathComponent(id))"
        )
    }

    func logout() async throws {
        defer { clearCredentials() }
        _ = try await sendData(method: "POST", path: "/api/auth/logout", body: try encoder.encode(EmptyBody()))
    }

    func clearCredentials() {
        bearerToken = nil
        hasBearerToken = false
        proxySession = nil
        try? tokenStore.deleteToken()
        HTTPCookieStorage.shared.cookies(for: baseURL)?.forEach(HTTPCookieStorage.shared.deleteCookie)
    }

    // MARK: - Library endpoints

    func library() async throws -> LibraryOverview {
        try await json(method: "GET", path: "/api/auth/library")
    }

    func setFavorite(_ track: Track) async throws -> Bool {
        let payload: FavoriteMutationPayload = try await json(
            method: "PUT",
            path: "/api/auth/library/favorites",
            body: TrackBody(track: track)
        )
        return payload.favorite
    }

    func removeFavorite(_ track: Track) async throws -> Bool {
        let path = "/api/auth/library/favorites/\(Self.pathComponent(track.source.rawValue))/\(Self.pathComponent(track.id))"
        let payload: FavoriteRemovalPayload = try await json(method: "DELETE", path: path)
        return payload.removed
    }

    func addRecent(_ track: Track) async throws {
        let _: RecentMutationPayload = try await json(
            method: "POST",
            path: "/api/auth/library/recent",
            body: TrackBody(track: track)
        )
    }

    func clearRecent() async throws {
        _ = try await sendData(method: "DELETE", path: "/api/auth/library/recent")
    }

    func savePlaylist(_ snapshot: PlaylistSnapshot) async throws -> PlaylistSummary {
        let path = "/api/auth/library/playlists/\(Self.pathComponent(snapshot.source.rawValue))/\(Self.pathComponent(snapshot.id))"
        let payload: SavedPlaylistPayload = try await json(
            method: "PUT",
            path: path,
            body: PlaylistBody(playlist: snapshot)
        )
        return payload.playlist
    }

    func savedPlaylist(source: MusicSource, id: String) async throws -> PlaylistSnapshot {
        let path = "/api/auth/library/playlists/\(Self.pathComponent(source.rawValue))/\(Self.pathComponent(id))"
        let payload: PlaylistPayload = try await json(method: "GET", path: path)
        return payload.playlist
    }

    func removeSavedPlaylist(source: MusicSource, id: String) async throws -> Bool {
        let path = "/api/auth/library/playlists/\(Self.pathComponent(source.rawValue))/\(Self.pathComponent(id))"
        let payload: PlaylistRemovalPayload = try await json(method: "DELETE", path: path)
        return payload.removed
    }

    // MARK: - Transport

    private func collection(
        kind: CollectionKind,
        source: MusicSource,
        id: String,
        pageSize: Int,
        refresh: Bool = false
    ) async throws -> CollectionDetail {
        let resource = kind == .playlist ? "playlists" : "\(kind.rawValue)s"
        let requestedSource = source == .aggregate && kind == .playlist ? MusicSource.aggregate : source
        let path = "/api/proxy/v2/\(resource)/\(Self.pathComponent(requestedSource.rawValue))/\(Self.pathComponent(id))"
        var offset = 0
        var allTracks: [Track] = []
        var first: CollectionDetail?

        for pageNumber in 0..<100 {
            var queryItems = [
                URLQueryItem(name: "offset", value: String(offset)),
                URLQueryItem(name: "limit", value: String(pageSize)),
                URLQueryItem(name: "view", value: "compact")
            ]
            if refresh && pageNumber == 0 { queryItems.append(URLQueryItem(name: "refresh", value: "true")) }
            let data = try await sendData(method: "GET", path: path, queryItems: queryItems)
            let envelope: APIEnvelope<CollectionDetail> = try decode(APIEnvelope<CollectionDetail>.self, from: data)
            let probe: APIEnvelope<TrackPageProbe> = try decode(APIEnvelope<TrackPageProbe>.self, from: data)
            if first == nil { first = envelope.data }
            let pageTracks = probe.data.tracks.items
            allTracks.append(contentsOf: pageTracks)
            guard probe.data.tracks.hasMore, !pageTracks.isEmpty else { break }
            offset += pageTracks.count
        }

        guard let decoded = first else { throw RMusicAPIError.invalidResponse }
        return CollectionDetail(
            id: decoded.id,
            source: decoded.source == .aggregate ? requestedSource : decoded.source,
            kind: kind,
            name: decoded.name,
            artwork: decoded.artwork,
            cover: decoded.cover,
            description: decoded.description,
            artists: decoded.artists,
            creator: decoded.creator,
            genres: decoded.genres,
            label: decoded.label,
            releaseDate: decoded.releaseDate,
            stats: CollectionStats(
                trackCount: allTracks.count,
                playCount: decoded.stats.playCount,
                followerCount: decoded.stats.followerCount
            ),
            tracks: allTracks,
            albums: decoded.albums
        )
    }

    private func proxyEnvelope<Value: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = []
    ) async throws -> Value {
        let data = try await sendData(method: "GET", path: path, queryItems: queryItems)
        let envelope: APIEnvelope<Value> = try decode(APIEnvelope<Value>.self, from: data)
        return envelope.data
    }

    private func json<Response: Decodable, Body: Encodable>(
        method: String,
        path: String,
        queryItems: [URLQueryItem] = [],
        body: Body
    ) async throws -> Response {
        let bodyData = try encoder.encode(body)
        let data = try await sendData(method: method, path: path, queryItems: queryItems, body: bodyData)
        return try decode(Response.self, from: data)
    }

    private func json<Response: Decodable>(
        method: String,
        path: String,
        queryItems: [URLQueryItem] = []
    ) async throws -> Response {
        let data = try await sendData(method: method, path: path, queryItems: queryItems)
        return try decode(Response.self, from: data)
    }

    private func sendData(
        method: String,
        path: String,
        queryItems: [URLQueryItem] = [],
        body: Data? = nil,
        accept: String = "application/json",
        retryProxyAuthentication: Bool = true
    ) async throws -> Data {
        try await sendData(
            method: method,
            url: makeURL(path: path, queryItems: queryItems),
            body: body,
            accept: accept,
            retryProxyAuthentication: retryProxyAuthentication
        )
    }

    private func sendData(
        method: String,
        url: URL,
        body: Data? = nil,
        accept: String = "application/json",
        retryProxyAuthentication: Bool = true
    ) async throws -> Data {
        var request = authorizedRequest(for: url)
        request.httpMethod = method
        request.setValue(accept, forHTTPHeaderField: "Accept")
        if isRMusicServiceURL(url) {
            request.setValue(RMusicService.clientIdentifier, forHTTPHeaderField: "X-RMusic-Client")
        }
        if isRMusicServiceURL(url),
           url.path.hasPrefix("/api/auth") || url.path == "/api/proxy/session" {
            request.setValue(RMusicService.origin, forHTTPHeaderField: "Origin")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw RMusicAPIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw RMusicAPIError.invalidResponse }

        if http.statusCode == 401,
           retryProxyAuthentication,
           url.path.hasPrefix("/api/proxy/v2/") {
            _ = try? await bootstrapProxySession(force: true)
            return try await sendData(
                method: method,
                url: url,
                body: body,
                accept: accept,
                retryProxyAuthentication: false
            )
        }

        guard (200..<300).contains(http.statusCode) else {
            let problem = try? decoder.decode(APIProblem.self, from: data)
            if http.statusCode == 401 {
                throw RMusicAPIError.authenticationRequired(
                    problem?.detail ?? "请先使用设备密钥登录 RMusic ID。"
                )
            }
            throw RMusicAPIError.http(status: http.statusCode, problem: problem)
        }
        return data
    }

    private func decode<Value: Decodable>(_ type: Value.Type, from data: Data) throws -> Value {
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw RMusicAPIError.decoding(error.localizedDescription)
        }
    }

    private func persistAccessToken(from status: AccountStatus) throws {
        guard status.authenticated, let token = status.accessToken else {
            throw RMusicAPIError.authenticationRequired("服务器没有签发手机客户端凭据。")
        }
        try tokenStore.saveToken(token)
        bearerToken = token
        hasBearerToken = true
    }

    private static func pathComponent(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private func isRMusicServiceURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == baseURL.scheme?.lowercased(),
              url.host?.lowercased() == baseURL.host?.lowercased() else { return false }
        return url.port == baseURL.port
    }
}

private struct EmptyBody: Encodable {}

private struct PasskeyVerificationBody: Encodable {
    let flowId: String
    let response: PasskeyCredentialPayload
    let sessionMode: String?
    let deviceName: String
}

private struct TrackPageProbe: Decodable {
    let tracks: CatalogTrackPage
}

private struct TrackBody: Encodable {
    let track: Track
}

private struct PlaylistBody: Encodable {
    let playlist: PlaylistSnapshot
}

struct LibraryOverview: Decodable, Sendable {
    let favorites: [Track]
    let recent: [Track]
    let playlists: [PlaylistSummary]
    let empty: Bool
}

private struct FavoriteMutationPayload: Decodable {
    let favorite: Bool
}

private struct FavoriteRemovalPayload: Decodable {
    let favorite: Bool
    let removed: Bool
}

private struct RecentMutationPayload: Decodable {
    let recent: Bool
}

private struct SavedPlaylistPayload: Decodable {
    let saved: Bool
    let playlist: PlaylistSummary
}

private struct PlaylistPayload: Decodable {
    let playlist: PlaylistSnapshot
}

private struct PlaylistRemovalPayload: Decodable {
    let saved: Bool
    let removed: Bool
}
