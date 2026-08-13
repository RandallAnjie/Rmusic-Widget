import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class ImageCache {
    static let shared = ImageCache()

    @ObservationIgnored private let cache = NSCache<NSURL, UIImage>()
    @ObservationIgnored private var inFlight: [URL: Task<UIImage, Error>] = [:]
    @ObservationIgnored private let api: RMusicAPIClient

    init(api: RMusicAPIClient? = nil, memoryLimitMB: Int = 64) {
        self.api = api ?? .shared
        cache.totalCostLimit = max(8, memoryLimitMB) * 1_024 * 1_024
        cache.countLimit = 256
    }

    func cachedImage(for url: URL?) -> UIImage? {
        guard let url else { return nil }
        return cache.object(forKey: url as NSURL)
    }

    func image(for url: URL) async throws -> UIImage {
        if let cached = cache.object(forKey: url as NSURL) { return cached }
        if let task = inFlight[url] { return try await task.value }

        let task = Task { [api] in
            let data = try await api.data(from: url)
            guard let image = UIImage(data: data) else {
                throw RMusicAPIError.decoding("封面不是有效图片")
            }
            return image
        }
        inFlight[url] = task
        defer { inFlight[url] = nil }
        let image = try await task.value
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: url as NSURL, cost: cost)
        return image
    }

    func setMemoryLimit(megabytes: Int) {
        cache.totalCostLimit = max(8, megabytes) * 1_024 * 1_024
    }

    func removeAll() {
        inFlight.values.forEach { $0.cancel() }
        inFlight = [:]
        cache.removeAllObjects()
    }
}

typealias RMusicImageCache = ImageCache
