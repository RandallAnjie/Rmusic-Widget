import Foundation
import Observation

@MainActor
@Observable
final class LibraryStore {
    private(set) var favorites: [Track] = []
    private(set) var recent: [Track] = []
    private(set) var playlists: [PlaylistSummary] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    let api: RMusicAPIClient
    private var favoriteIDs: Set<String> = []

    init(api: RMusicAPIClient? = nil) {
        self.api = api ?? .shared
    }

    func refresh() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }
        do {
            let overview = try await api.library()
            favorites = overview.favorites
            recent = overview.recent
            playlists = overview.playlists
            rebuildFavoriteIndex()
        } catch {
            errorMessage = Self.message(for: error)
        }
    }

    func isFavorite(_ track: Track) -> Bool {
        favoriteIDs.contains(track.stableID)
    }

    @discardableResult
    func toggleFavorite(_ track: Track) async throws -> Bool {
        errorMessage = nil
        let wasFavorite = isFavorite(track)
        if wasFavorite {
            favoriteIDs.remove(track.stableID)
            favorites.removeAll { $0.stableID == track.stableID }
        } else {
            favoriteIDs.insert(track.stableID)
            favorites.removeAll { $0.stableID == track.stableID }
            favorites.insert(track, at: 0)
            if favorites.count > 200 { favorites.removeLast(favorites.count - 200) }
        }

        do {
            if wasFavorite {
                _ = try await api.removeFavorite(track)
                return false
            } else {
                _ = try await api.setFavorite(track)
                return true
            }
        } catch {
            if wasFavorite {
                favoriteIDs.insert(track.stableID)
                favorites.insert(track, at: 0)
            } else {
                favoriteIDs.remove(track.stableID)
                favorites.removeAll { $0.stableID == track.stableID }
            }
            errorMessage = Self.message(for: error)
            throw error
        }
    }

    func addRecent(_ track: Track) async {
        recent.removeAll { $0.stableID == track.stableID }
        recent.insert(track, at: 0)
        if recent.count > 30 { recent.removeLast(recent.count - 30) }
        do {
            try await api.addRecent(track)
        } catch {
            errorMessage = Self.message(for: error)
        }
    }

    func clearRecent() async {
        errorMessage = nil
        let previous = recent
        recent = []
        do {
            try await api.clearRecent()
        } catch {
            recent = previous
            errorMessage = Self.message(for: error)
        }
    }

    @discardableResult
    func savePlaylist(_ snapshot: PlaylistSnapshot) async throws -> PlaylistSummary {
        errorMessage = nil
        do {
            let summary = try await api.savePlaylist(snapshot)
            playlists.removeAll { $0.stableID == summary.stableID }
            playlists.insert(summary, at: 0)
            if playlists.count > 60 { playlists.removeLast(playlists.count - 60) }
            return summary
        } catch {
            errorMessage = Self.message(for: error)
            throw error
        }
    }

    func loadPlaylist(_ summary: PlaylistSummary) async throws -> PlaylistSnapshot {
        try await loadPlaylist(source: summary.source, id: summary.id)
    }

    func loadPlaylist(source: MusicSource, id: String) async throws -> PlaylistSnapshot {
        errorMessage = nil
        do {
            return try await api.savedPlaylist(source: source, id: id)
        } catch {
            errorMessage = Self.message(for: error)
            throw error
        }
    }

    func removePlaylist(_ playlist: PlaylistSummary) async {
        errorMessage = nil
        let previous = playlists
        playlists.removeAll { $0.stableID == playlist.stableID }
        do {
            _ = try await api.removeSavedPlaylist(source: playlist.source, id: playlist.id)
        } catch {
            playlists = previous
            errorMessage = Self.message(for: error)
        }
    }

    func reset() {
        favorites = []
        recent = []
        playlists = []
        favoriteIDs = []
        errorMessage = nil
    }

    func clearError() {
        errorMessage = nil
    }

    private func rebuildFavoriteIndex() {
        favoriteIDs = Set(favorites.map(\.stableID))
    }

    private static func message(for error: Error) -> String {
        if let localized = error as? LocalizedError, let message = localized.errorDescription {
            return message
        }
        return error.localizedDescription
    }
}
