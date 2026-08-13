import Foundation

enum RMusicDeepLink: Hashable, Sendable {
    case home
    case search(query: String, source: MusicSource)
    case playlist(source: MusicSource, id: String)
    case album(source: MusicSource, id: String)
    case artist(source: MusicSource, id: String)
}

enum RMusicDeepLinkParser {
    static func parse(_ url: URL) -> RMusicDeepLink? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let isWeb = ["http", "https"].contains(url.scheme?.lowercased())
        if isWeb, url.host?.lowercased() != RMusicService.baseURL.host { return nil }
        guard isWeb || url.scheme?.lowercased() == "rmusic" else { return nil }

        let query = Dictionary(
            (components.queryItems ?? []).map { ($0.name.lowercased(), $0.value ?? "") },
            uniquingKeysWith: { _, last in last }
        )
        let route: String
        if url.scheme?.lowercased() == "rmusic" {
            route = (url.host?.isEmpty == false ? url.host! : url.path.split(separator: "/").first.map(String.init) ?? "")
                .lowercased()
        } else {
            route = (query["type"] ?? "").lowercased()
        }
        let source = MusicSource(rawValue: (query["server"] ?? query["source"] ?? "aggregate").lowercased()) ?? .aggregate

        if let search = query["q"]?.trimmingCharacters(in: .whitespacesAndNewlines), !search.isEmpty,
           route.isEmpty || route == "search" {
            return .search(query: search, source: source)
        }
        if route == "search" {
            return .search(query: "", source: source)
        }

        let pathParts = url.path.split(separator: "/").map(String.init)
        let id = (query["id"] ?? pathParts.last ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return route.isEmpty ? .home : nil }
        switch route {
        case "playlist": return .playlist(source: source, id: id)
        case "album": return .album(source: source, id: id)
        case "artist": return .artist(source: source, id: id)
        default: return isWeb ? .home : nil
        }
    }
}

struct PlaylistReference: Hashable, Sendable {
    let source: MusicSource
    let id: String
}

enum PlaylistReferenceParser {
    static func parse(_ input: String) -> PlaylistReference? {
        let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }
        if raw.range(of: #"^(?:PL|OLAK5uy_)"#, options: .regularExpression) != nil {
            return PlaylistReference(source: .ytmusic, id: raw)
        }
        if raw.lowercased().hasPrefix("pl.") {
            return PlaylistReference(source: .apple, id: raw)
        }
        guard let url = URL(string: raw), let host = url.host?.lowercased() else {
            return PlaylistReference(source: .aggregate, id: raw)
        }

        let source: MusicSource
        if host.contains("music.163.com") || host.hasSuffix("163cn.tv") { source = .netease }
        else if host.contains("y.qq.com") { source = .tencent }
        else if host.contains("kugou.com") { source = .kugou }
        else if host.contains("music.douyin.com") || host.contains("qishui.com") { source = .soda }
        else if host.contains("kuwo.cn") { source = .kuwo }
        else if host.contains("music.baidu.com") { source = .baidu }
        else if host.contains("youtube.com") || host == "youtu.be" { source = .ytmusic }
        else if host.contains("spotify.com") { source = .spotify }
        else if host.contains("music.apple.com") { source = .apple }
        else { source = .aggregate }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let values = Dictionary(
            (components?.queryItems ?? []).map { ($0.name, $0.value ?? "") },
            uniquingKeysWith: { _, last in last }
        )
        let fragmentValues: [String: String]
        if let fragment = components?.fragment,
           let marker = fragment.firstIndex(of: "?") {
            let query = String(fragment[fragment.index(after: marker)...])
            fragmentValues = Dictionary(
                (URLComponents(string: "?\(query)")?.queryItems ?? []).map { ($0.name, $0.value ?? "") },
                uniquingKeysWith: { _, last in last }
            )
        } else {
            fragmentValues = [:]
        }
        let id = values["id"]
            ?? values["list"]
            ?? values["playlistId"]
            ?? values["global_collection_id"]
            ?? fragmentValues["id"]
            ?? fragmentValues["list"]
            ?? url.path.split(separator: "/").last.map(String.init)
        guard let id, !id.isEmpty else { return nil }
        return PlaylistReference(source: source, id: id)
    }
}
