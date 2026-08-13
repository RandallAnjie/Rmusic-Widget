import Foundation

enum RMusicService {
    static let baseURL = URL(string: "https://music.bigrandall.io")!
    static let clientIdentifier = "ios-v1"
    static let origin = "https://music.bigrandall.io"
}

enum MusicSource: String, CaseIterable, Codable, Hashable, Sendable {
    case aggregate
    case tencent
    case netease
    case kugou
    case soda
    case ytmusic
    case kuwo
    case baidu
    case apple
    case spotify

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = (try? container.decode(String.self))?.lowercased() ?? "aggregate"
        self = MusicSource(rawValue: rawValue) ?? .aggregate
    }
}

enum PlaybackQuality: String, CaseIterable, Codable, Hashable, Sendable, Identifiable {
    case auto
    case lossless
    case high
    case standard
    case low

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .auto: "自动"
        case .lossless: "无损"
        case .high: "高品质"
        case .standard: "标准"
        case .low: "省流"
        }
    }
}

struct ArtistReference: Codable, Hashable, Sendable, Identifiable {
    let id: String?
    let name: String

    init(id: String? = nil, name: String) {
        self.id = id
        self.name = name
    }

    init(from decoder: Decoder) throws {
        if let value = try? decoder.singleValueContainer().decode(String.self) {
            id = nil
            name = value
            return
        }
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        id = container.flexibleString(for: "id")
        name = container.flexibleString(for: "name") ?? container.flexibleString(for: "title") ?? "未知艺人"
    }

    /// QQ Music search/discovery sometimes exposes a legacy numeric singer ID,
    /// while the V2 artist endpoint requires the canonical alphanumeric MID.
    /// Treat that legacy form as non-navigable so the UI can fall back to a
    /// useful name search instead of presenting a guaranteed 404.
    func catalogID(for source: MusicSource) -> String? {
        guard let id else { return nil }
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if source == .tencent, trimmed.allSatisfy(\.isNumber) { return nil }
        return trimmed
    }
}

struct AlbumReference: Codable, Hashable, Sendable {
    let id: String?
    let name: String

    init(id: String? = nil, name: String) {
        self.id = id
        self.name = name
    }

    init(from decoder: Decoder) throws {
        if let value = try? decoder.singleValueContainer().decode(String.self) {
            id = nil
            name = value
            return
        }
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        id = container.flexibleString(for: "id")
        name = container.flexibleString(for: "name") ?? container.flexibleString(for: "title") ?? ""
    }
}

struct Artwork: Codable, Hashable, Sendable {
    let url: String?
    let originalURL: String?

    init(url: String? = nil, originalURL: String? = nil) {
        self.url = url
        self.originalURL = originalURL
    }

    enum CodingKeys: String, CodingKey {
        case url
        case originalURL
        case originalUrl
    }

    init(from decoder: Decoder) throws {
        if let value = try? decoder.singleValueContainer().decode(String.self) {
            url = value
            originalURL = nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        url = try container.decodeIfPresent(String.self, forKey: .url)
        originalURL = try container.decodeIfPresent(String.self, forKey: .originalURL)
            ?? container.decodeIfPresent(String.self, forKey: .originalUrl)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(url, forKey: .url)
        try container.encodeIfPresent(originalURL, forKey: .originalURL)
    }
}

struct TrackLinks: Codable, Hashable, Sendable {
    let selfURL: String?
    let stream: String?
    let artwork: String?
    let lyrics: String?
    let wordLyrics: String?

    init(
        selfURL: String? = nil,
        stream: String? = nil,
        artwork: String? = nil,
        lyrics: String? = nil,
        wordLyrics: String? = nil
    ) {
        self.selfURL = selfURL
        self.stream = stream
        self.artwork = artwork
        self.lyrics = lyrics
        self.wordLyrics = wordLyrics
    }

    enum CodingKeys: String, CodingKey {
        case selfURL = "self"
        case stream
        case artwork
        case lyrics
        case wordLyrics
    }

    var streamURL: URL? { RMusicURL.resolve(stream) }
    var artworkURL: URL? { RMusicURL.resolve(artwork) }
    var lyricsURL: URL? { RMusicURL.resolve(lyrics) }
    var wordLyricsURL: URL? { RMusicURL.resolve(wordLyrics) }
}

struct PlaybackQualityOption: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let label: String
    let available: Bool

    init(id: String, label: String, available: Bool = true) {
        self.id = id
        self.label = label
        self.available = available
    }
}

struct PlaybackAvailability: Codable, Hashable, Sendable {
    let available: Bool
    let previewOnly: Bool
    let requiresSubscription: Bool
    let qualities: [PlaybackQualityOption]

    init(
        available: Bool = true,
        previewOnly: Bool = false,
        requiresSubscription: Bool = false,
        qualities: [PlaybackQualityOption] = []
    ) {
        self.available = available
        self.previewOnly = previewOnly
        self.requiresSubscription = requiresSubscription
        self.qualities = qualities
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        available = container.flexibleBool(for: "available") ?? true
        previewOnly = container.flexibleBool(for: "previewOnly")
            ?? container.flexibleBool(for: "preview_only")
            ?? false
        requiresSubscription = container.flexibleBool(for: "requiresSubscription")
            ?? container.flexibleBool(for: "requires_subscription")
            ?? false
        qualities = (try? container.decode([PlaybackQualityOption].self, forKey: .init("qualities"))) ?? []
    }
}

struct Track: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let source: MusicSource
    let title: String
    let artists: [ArtistReference]
    let album: AlbumReference?
    let durationMs: Int?
    let artwork: Artwork?
    let links: TrackLinks
    let playback: PlaybackAvailability?

    init(
        id: String,
        source: MusicSource,
        title: String,
        artists: [ArtistReference] = [],
        album: AlbumReference? = nil,
        durationMs: Int? = nil,
        artwork: Artwork? = nil,
        links: TrackLinks = TrackLinks(),
        playback: PlaybackAvailability? = nil
    ) {
        self.id = id
        self.source = source
        self.title = title
        self.artists = artists
        self.album = album
        self.durationMs = durationMs
        self.artwork = artwork
        self.links = links
        self.playback = playback
    }

    var stableID: String { "\(source.rawValue):\(id)" }
    var resourceID: String { id }
    var artistsText: String {
        let names = artists.map(\.name).filter { !$0.isEmpty }
        return names.isEmpty ? "未知艺人" : names.joined(separator: " / ")
    }
    var albumName: String { album?.name ?? "" }
    var artworkURL: URL? { RMusicURL.resolve(artwork?.url ?? links.artwork ?? artwork?.originalURL) }
    var duration: TimeInterval { TimeInterval(durationMs ?? 0) / 1_000 }

    func lyricsURL(wordLevel: Bool = false) -> URL? {
        RMusicURL.resolve(wordLevel ? (links.wordLyrics ?? links.lyrics) : links.lyrics)
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        id = container.flexibleString(for: "id") ?? ""
        let sourceValue = container.flexibleString(for: "source")
            ?? container.flexibleString(for: "server")
            ?? "aggregate"
        source = MusicSource(rawValue: sourceValue.lowercased()) ?? .aggregate
        title = container.flexibleString(for: "title")
            ?? container.flexibleString(for: "name")
            ?? "未知歌曲"

        if let decoded = try? container.decode([ArtistReference].self, forKey: .init("artists")) {
            artists = decoded
        } else if let decoded = try? container.decode([ArtistReference].self, forKey: .init("artistItems")) {
            artists = decoded
        } else if let author = container.flexibleString(for: "author"), !author.isEmpty {
            artists = [ArtistReference(name: author)]
        } else {
            artists = []
        }

        album = (try? container.decodeIfPresent(AlbumReference.self, forKey: .init("album")))
            ?? (try? container.decodeIfPresent(AlbumReference.self, forKey: .init("albumResource")))

        let rawDuration = container.flexibleInt(for: "durationMs")
            ?? container.flexibleInt(for: "duration_ms")
            ?? container.flexibleInt(for: "duration")
        if let rawDuration, container.contains(.init("duration")), !container.contains(.init("durationMs")),
           !container.contains(.init("duration_ms")), rawDuration > 0, rawDuration < 86_400 {
            durationMs = rawDuration * 1_000
        } else {
            durationMs = rawDuration
        }

        let decodedArtwork = try? container.decodeIfPresent(Artwork.self, forKey: .init("artwork"))
        let legacyArtwork = container.flexibleString(for: "pic")
        artwork = decodedArtwork ?? legacyArtwork.map { Artwork(url: $0) }

        let decodedLinks = (try? container.decodeIfPresent(TrackLinks.self, forKey: .init("links"))) ?? nil
        links = TrackLinks(
            selfURL: decodedLinks?.selfURL,
            stream: decodedLinks?.stream ?? container.flexibleString(for: "url"),
            artwork: decodedLinks?.artwork ?? legacyArtwork,
            lyrics: decodedLinks?.lyrics ?? container.flexibleString(for: "lrc"),
            wordLyrics: decodedLinks?.wordLyrics ?? container.flexibleString(for: "lrcpword")
        )
        playback = (try? container.decodeIfPresent(PlaybackAvailability.self, forKey: .init("playback"))) ?? nil
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        try container.encode(id, forKey: .init("id"))
        try container.encode(source.rawValue, forKey: .init("source"))
        try container.encode(source.rawValue, forKey: .init("server"))
        try container.encode(title, forKey: .init("title"))
        try container.encode(artistsText, forKey: .init("author"))
        try container.encode(artists, forKey: .init("artists"))
        try container.encodeIfPresent(album, forKey: .init("album"))
        try container.encodeIfPresent(durationMs, forKey: .init("duration_ms"))
        try container.encodeIfPresent(artwork, forKey: .init("artwork"))
        try container.encodeIfPresent(artwork?.url ?? links.artwork, forKey: .init("pic"))
        try container.encode(links, forKey: .init("links"))
        try container.encodeIfPresent(links.stream, forKey: .init("url"))
        try container.encodeIfPresent(links.lyrics, forKey: .init("lrc"))
        try container.encodeIfPresent(links.wordLyrics, forKey: .init("lrcpword"))
        try container.encodeIfPresent(playback, forKey: .init("playback"))
    }
}

struct DiscoveryPayload: Codable, Hashable, Sendable {
    let recommendations: [Track]
    let charts: [Track]
    let newReleases: [Track]

    init(recommendations: [Track] = [], charts: [Track] = [], newReleases: [Track] = []) {
        self.recommendations = recommendations
        self.charts = charts
        self.newReleases = newReleases
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        recommendations = (try? container.decode([Track].self, forKey: .init("recommendations"))) ?? []
        charts = (try? container.decode([Track].self, forKey: .init("charts"))) ?? []
        newReleases = (try? container.decode([Track].self, forKey: .init("newReleases")))
            ?? (try? container.decode([Track].self, forKey: .init("new_releases")))
            ?? []
    }
}

struct SourceSearchStatus: Codable, Hashable, Sendable, Identifiable {
    let source: String
    let status: String
    let count: Int
    let httpStatus: Int?

    var id: String { source }
}

struct SearchMetadata: Codable, Hashable, Sendable {
    let complete: Bool
    let total: Int?
    let sources: [SourceSearchStatus]

    init(complete: Bool = true, total: Int? = nil, sources: [SourceSearchStatus] = []) {
        self.complete = complete
        self.total = total
        self.sources = sources
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        complete = container.flexibleBool(for: "complete") ?? true
        total = container.flexibleInt(for: "total")
        sources = (try? container.decode([SourceSearchStatus].self, forKey: .init("sources"))) ?? []
    }
}

struct SearchResult: Codable, Hashable, Sendable {
    let tracks: [Track]
    let metadata: SearchMetadata
}

struct Creator: Codable, Hashable, Sendable, Identifiable {
    let id: String?
    let name: String
    let avatar: String?
    let role: String?

    init(id: String? = nil, name: String, avatar: String? = nil, role: String? = nil) {
        self.id = id
        self.name = name
        self.avatar = avatar
        self.role = role
    }
}

struct CollectionStats: Codable, Hashable, Sendable {
    let trackCount: Int
    let playCount: Int?
    let followerCount: Int?

    init(trackCount: Int = 0, playCount: Int? = nil, followerCount: Int? = nil) {
        self.trackCount = trackCount
        self.playCount = playCount
        self.followerCount = followerCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        trackCount = container.flexibleInt(for: "trackCount")
            ?? container.flexibleInt(for: "track_count")
            ?? 0
        playCount = container.flexibleInt(for: "playCount") ?? container.flexibleInt(for: "play_count")
        followerCount = container.flexibleInt(for: "followerCount") ?? container.flexibleInt(for: "follower_count")
    }
}

struct CatalogTrackPage: Codable, Hashable, Sendable {
    var items: [Track]
    var total: Int
    var offset: Int
    var limit: Int
    var hasMore: Bool

    init(items: [Track] = [], total: Int = 0, offset: Int = 0, limit: Int = 0, hasMore: Bool = false) {
        self.items = items
        self.total = total
        self.offset = offset
        self.limit = limit
        self.hasMore = hasMore
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        items = (try? container.decode([Track].self, forKey: .init("items"))) ?? []
        total = container.flexibleInt(for: "total") ?? items.count
        offset = container.flexibleInt(for: "offset") ?? 0
        limit = container.flexibleInt(for: "limit") ?? items.count
        hasMore = container.flexibleBool(for: "hasMore")
            ?? container.flexibleBool(for: "has_more")
            ?? (offset + items.count < total)
    }
}

enum CollectionKind: String, Codable, Hashable, Sendable {
    case album
    case artist
    case playlist
}

struct CollectionDetail: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let source: MusicSource
    let kind: CollectionKind
    var name: String
    var artwork: Artwork?
    var cover: String?
    var description: String
    var artists: [ArtistReference]
    var creator: Creator?
    var genres: [String]
    var label: String?
    var releaseDate: String?
    var stats: CollectionStats
    var tracks: [Track]
    var albums: [Album]

    var stableID: String { "\(kind.rawValue):\(source.rawValue):\(id)" }
    var title: String { name }
    var artworkURL: URL? { RMusicURL.resolve(cover ?? artwork?.url ?? artwork?.originalURL) }
    var creatorName: String { creator?.name ?? artists.map(\.name).joined(separator: " / ") }

    init(
        id: String,
        source: MusicSource,
        kind: CollectionKind,
        name: String,
        artwork: Artwork? = nil,
        cover: String? = nil,
        description: String = "",
        artists: [ArtistReference] = [],
        creator: Creator? = nil,
        genres: [String] = [],
        label: String? = nil,
        releaseDate: String? = nil,
        stats: CollectionStats = CollectionStats(),
        tracks: [Track] = [],
        albums: [Album] = []
    ) {
        self.id = id
        self.source = source
        self.kind = kind
        self.name = name
        self.artwork = artwork
        self.cover = cover
        self.description = description
        self.artists = artists
        self.creator = creator
        self.genres = genres
        self.label = label
        self.releaseDate = releaseDate
        self.stats = stats
        self.tracks = tracks
        self.albums = albums
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        id = container.flexibleString(for: "id") ?? ""
        let sourceValue = container.flexibleString(for: "source") ?? container.flexibleString(for: "server") ?? "aggregate"
        source = MusicSource(rawValue: sourceValue.lowercased()) ?? .aggregate
        let rawKind = container.flexibleString(for: "resourceType")
            ?? container.flexibleString(for: "type")
            ?? "album"
        kind = CollectionKind(rawValue: rawKind) ?? .album
        name = container.flexibleString(for: "name") ?? container.flexibleString(for: "title") ?? "未命名目录"
        artwork = (try? container.decodeIfPresent(Artwork.self, forKey: .init("artwork"))) ?? nil
        cover = container.flexibleString(for: "cover")
        description = container.flexibleString(for: "description") ?? ""
        artists = (try? container.decode([ArtistReference].self, forKey: .init("artists"))) ?? []
        creator = (try? container.decodeIfPresent(Creator.self, forKey: .init("creator"))) ?? nil
        genres = (try? container.decode([String].self, forKey: .init("genres"))) ?? []
        label = container.flexibleString(for: "label")
        releaseDate = container.flexibleString(for: "releaseDate") ?? container.flexibleString(for: "release_date")
        stats = (try? container.decode(CollectionStats.self, forKey: .init("stats"))) ?? CollectionStats()
        if let page = try? container.decode(CatalogTrackPage.self, forKey: .init("tracks")) {
            tracks = page.items
        } else {
            tracks = (try? container.decode([Track].self, forKey: .init("tracks"))) ?? []
        }
        albums = (try? container.decode([Album].self, forKey: .init("albums"))) ?? []
    }
}

struct Album: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let source: MusicSource
    let name: String
    let albumType: String?
    let releaseDate: String?
    let artwork: Artwork?
    let stats: CollectionStats?

    var stableID: String { "album:\(source.rawValue):\(id)" }
    var title: String { name }
    var artworkURL: URL? { RMusicURL.resolve(artwork?.url ?? artwork?.originalURL) }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        id = container.flexibleString(for: "id") ?? ""
        let sourceValue = container.flexibleString(for: "source") ?? container.flexibleString(for: "server") ?? "aggregate"
        source = MusicSource(rawValue: sourceValue.lowercased()) ?? .aggregate
        name = container.flexibleString(for: "name") ?? container.flexibleString(for: "title") ?? "未命名专辑"
        albumType = container.flexibleString(for: "albumType") ?? container.flexibleString(for: "album_type")
        releaseDate = container.flexibleString(for: "releaseDate") ?? container.flexibleString(for: "release_date")
        artwork = (try? container.decodeIfPresent(Artwork.self, forKey: .init("artwork"))) ?? nil
        stats = (try? container.decodeIfPresent(CollectionStats.self, forKey: .init("stats"))) ?? nil
    }
}

struct Artist: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let source: MusicSource
    let name: String
    let artwork: Artwork?
    let description: String

    var stableID: String { "artist:\(source.rawValue):\(id)" }
    var artworkURL: URL? { RMusicURL.resolve(artwork?.url ?? artwork?.originalURL) }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        id = container.flexibleString(for: "id") ?? ""
        let sourceValue = container.flexibleString(for: "source") ?? container.flexibleString(for: "server") ?? "aggregate"
        source = MusicSource(rawValue: sourceValue.lowercased()) ?? .aggregate
        name = container.flexibleString(for: "name") ?? container.flexibleString(for: "title") ?? "未知艺人"
        artwork = (try? container.decodeIfPresent(Artwork.self, forKey: .init("artwork"))) ?? nil
        description = container.flexibleString(for: "description") ?? ""
    }
}

struct PlaylistSummary: Codable, Hashable, Sendable, Identifiable {
    let source: MusicSource
    let id: String
    let title: String
    let cover: String?
    let creator: Creator?
    let trackCount: Int
    let cachedAt: Date?
    let savedAt: Date?

    var stableID: String { "\(source.rawValue):\(id)" }
    var artworkURL: URL? { RMusicURL.resolve(cover) }
    var creatorName: String { creator?.name ?? "" }
    var name: String { title }

    init(
        source: MusicSource,
        id: String,
        title: String,
        cover: String? = nil,
        creator: Creator? = nil,
        trackCount: Int = 0,
        cachedAt: Date? = nil,
        savedAt: Date? = nil
    ) {
        self.source = source
        self.id = id
        self.title = title
        self.cover = cover
        self.creator = creator
        self.trackCount = trackCount
        self.cachedAt = cachedAt
        self.savedAt = savedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        let sourceValue = container.flexibleString(for: "source") ?? container.flexibleString(for: "server") ?? "aggregate"
        source = MusicSource(rawValue: sourceValue.lowercased()) ?? .aggregate
        id = container.flexibleString(for: "id") ?? ""
        title = container.flexibleString(for: "title")
            ?? container.flexibleString(for: "name")
            ?? "歌单 \(id)"
        cover = container.flexibleString(for: "cover")
            ?? container.flexibleString(for: "artworkURL")
            ?? container.flexibleString(for: "artwork_url")
        creator = (try? container.decodeIfPresent(Creator.self, forKey: .init("creator"))) ?? nil
        if let direct = container.flexibleInt(for: "trackCount") ?? container.flexibleInt(for: "track_count") {
            trackCount = direct
        } else {
            trackCount = (try? container.decode(CollectionStats.self, forKey: .init("stats")))?.trackCount ?? 0
        }
        cachedAt = container.flexibleDate(for: "cachedAt") ?? container.flexibleDate(for: "cached_at")
        savedAt = container.flexibleDate(for: "savedAt") ?? container.flexibleDate(for: "saved_at")
    }
}

struct PlaylistSnapshot: Codable, Hashable, Sendable, Identifiable {
    let version: Int
    let source: MusicSource
    let id: String
    let title: String
    let cover: String?
    let description: String
    let creator: Creator?
    let stats: CollectionStats
    let tracks: [Track]
    let cachedAt: Date
    let savedAt: Date

    var stableID: String { "\(source.rawValue):\(id)" }
    var artworkURL: URL? { RMusicURL.resolve(cover) }
    var creatorName: String { creator?.name ?? "" }
    var name: String { title }
    var summary: PlaylistSummary {
        PlaylistSummary(
            source: source,
            id: id,
            title: title,
            cover: cover,
            creator: creator,
            trackCount: tracks.count,
            cachedAt: cachedAt,
            savedAt: savedAt
        )
    }

    init(
        version: Int = 2,
        source: MusicSource,
        id: String,
        title: String,
        cover: String? = nil,
        description: String = "",
        creator: Creator? = nil,
        stats: CollectionStats? = nil,
        tracks: [Track],
        cachedAt: Date = Date(),
        savedAt: Date = Date()
    ) {
        self.version = version
        self.source = source
        self.id = id
        self.title = title
        self.cover = cover
        self.description = description
        self.creator = creator
        self.stats = stats ?? CollectionStats(trackCount: tracks.count)
        self.tracks = tracks
        self.cachedAt = cachedAt
        self.savedAt = savedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        version = container.flexibleInt(for: "version") ?? 2
        let sourceValue = container.flexibleString(for: "source") ?? container.flexibleString(for: "server") ?? "aggregate"
        source = MusicSource(rawValue: sourceValue.lowercased()) ?? .aggregate
        id = container.flexibleString(for: "id") ?? ""
        title = container.flexibleString(for: "title")
            ?? container.flexibleString(for: "name")
            ?? "歌单 \(id)"
        cover = container.flexibleString(for: "cover")
        description = container.flexibleString(for: "description") ?? ""
        creator = (try? container.decodeIfPresent(Creator.self, forKey: .init("creator"))) ?? nil
        tracks = (try? container.decode([Track].self, forKey: .init("tracks"))) ?? []
        stats = (try? container.decode(CollectionStats.self, forKey: .init("stats")))
            ?? CollectionStats(trackCount: tracks.count)
        cachedAt = container.flexibleDate(for: "cachedAt")
            ?? container.flexibleDate(for: "cached_at")
            ?? Date()
        savedAt = container.flexibleDate(for: "savedAt")
            ?? container.flexibleDate(for: "saved_at")
            ?? Date()
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        try container.encode(version, forKey: .init("version"))
        try container.encode(source.rawValue, forKey: .init("server"))
        try container.encode(id, forKey: .init("id"))
        try container.encode(title, forKey: .init("name"))
        try container.encodeIfPresent(cover, forKey: .init("cover"))
        try container.encode(description, forKey: .init("description"))
        try container.encodeIfPresent(creator, forKey: .init("creator"))
        try container.encode(stats, forKey: .init("stats"))
        try container.encode(tracks, forKey: .init("tracks"))
        try container.encode(cachedAt.millisecondsSince1970, forKey: .init("cachedAt"))
        try container.encode(savedAt.millisecondsSince1970, forKey: .init("savedAt"))
    }
}

struct APIEnvelope<Value: Decodable>: Decodable {
    let data: Value
    let meta: APIResponseMetadata?
    // Pagination intentionally uses JSON null at either boundary. Keeping the
    // values optional prevents an otherwise valid search response from making
    // the entire envelope fail to decode.
    let links: [String: String?]?
}

struct APIResponseMetadata: Codable, Hashable, Sendable {
    let apiVersion: String?
    let complete: Bool?
    let total: Int?
    let generatedAt: String?
    let sources: [SourceSearchStatus]?
}

struct APIProblem: Codable, Hashable, Sendable {
    let type: String?
    let title: String
    let status: Int
    let detail: String?
    let apiVersion: String?

    init(type: String? = nil, title: String, status: Int, detail: String? = nil, apiVersion: String? = nil) {
        self.type = type
        self.title = title
        self.status = status
        self.detail = detail
        self.apiVersion = apiVersion
    }
}

enum RMusicURL {
    static func resolve(_ value: String?, relativeTo baseURL: URL = RMusicService.baseURL) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        return URL(string: value, relativeTo: baseURL)?.absoluteURL
    }
}

struct DynamicCodingKey: CodingKey, Hashable {
    let stringValue: String
    let intValue: Int?

    init(_ stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(stringValue: String) {
        self.init(stringValue)
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

private extension KeyedDecodingContainer where Key == DynamicCodingKey {
    func flexibleString(for name: String) -> String? {
        let key = DynamicCodingKey(name)
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        if let value = try? decodeIfPresent(Int64.self, forKey: key) { return String(value) }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return String(value) }
        return nil
    }

    func flexibleInt(for name: String) -> Int? {
        let key = DynamicCodingKey(name)
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return Int(value) }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return Double(value).map(Int.init) }
        return nil
    }

    func flexibleBool(for name: String) -> Bool? {
        let key = DynamicCodingKey(name)
        if let value = try? decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value != 0 }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            switch value.lowercased() {
            case "true", "1", "yes": return true
            case "false", "0", "no": return false
            default: return nil
            }
        }
        return nil
    }

    func flexibleDate(for name: String) -> Date? {
        let key = DynamicCodingKey(name)
        if let number = try? decodeIfPresent(Double.self, forKey: key) {
            return Date(millisecondsOrSecondsSince1970: number)
        }
        if let text = try? decodeIfPresent(String.self, forKey: key) {
            if let number = Double(text) { return Date(millisecondsOrSecondsSince1970: number) }
            return ISO8601DateFormatter().date(from: text)
        }
        return nil
    }
}

extension Date {
    init(millisecondsOrSecondsSince1970 value: Double) {
        self.init(timeIntervalSince1970: value > 10_000_000_000 ? value / 1_000 : value)
    }

    var millisecondsSince1970: Int64 {
        Int64((timeIntervalSince1970 * 1_000).rounded())
    }
}
