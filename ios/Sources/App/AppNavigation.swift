import Foundation

enum RMusicTab: String, CaseIterable, Identifiable {
    case home
    case search
    case library
    case account

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "首页"
        case .search: "搜索"
        case .library: "音乐库"
        case .account: "账号"
        }
    }

    var symbol: String {
        switch self {
        case .home: "house"
        case .search: "magnifyingglass"
        case .library: "music.note.list"
        case .account: "person.crop.circle"
        }
    }

    var selectedSymbol: String {
        switch self {
        case .home: "house.fill"
        case .search: "magnifyingglass"
        case .library: "music.note.list"
        case .account: "person.crop.circle.fill"
        }
    }
}

enum CatalogRoute: Hashable, Identifiable {
    case album(source: MusicSource, id: String)
    case artist(source: MusicSource, id: String)
    case playlist(source: MusicSource, id: String, title: String?)

    var id: String {
        switch self {
        case .album(let source, let id): "album:\(source.rawValue):\(id)"
        case .artist(let source, let id): "artist:\(source.rawValue):\(id)"
        case .playlist(let source, let id, _): "playlist:\(source.rawValue):\(id)"
        }
    }
}
