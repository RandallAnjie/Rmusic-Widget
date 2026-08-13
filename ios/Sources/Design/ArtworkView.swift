import SwiftUI
import UIKit

struct ArtworkView: View {
    let url: URL?
    let title: String
    var size: CGFloat
    var cornerRadius: CGFloat? = nil

    var body: some View {
        AuthenticatedArtworkImage(url: url, showsProgress: true) {
            placeholder
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius ?? max(8, size * 0.12), style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: cornerRadius ?? max(8, size * 0.12), style: .continuous))
    }

    private var placeholder: some View {
        EmptyArtwork(title: title, size: size)
    }
}

/// Loads RMusic artwork with the same authenticated URLSession transport as
/// catalog and playback requests. `AsyncImage` cannot attach the native Bearer
/// and is not guaranteed to share this app's proxy-cookie session.
struct AuthenticatedArtworkImage<Placeholder: View>: View {
    let url: URL?
    var showsProgress = false
    @ViewBuilder let placeholder: () -> Placeholder

    @State private var image: UIImage?
    @State private var isLoading = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else {
                placeholder()
                if showsProgress, isLoading {
                    ProgressView().tint(.white.opacity(0.7))
                }
            }
        }
        .task(id: url) {
            await load()
        }
    }

    @MainActor
    private func load() async {
        image = ImageCache.shared.cachedImage(for: url)
        guard image == nil, let url else {
            isLoading = false
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await ImageCache.shared.image(for: url)
            try Task.checkCancellation()
            withAnimation(.easeOut(duration: 0.22)) { image = loaded }
        } catch is CancellationError {
            return
        } catch {
            image = nil
        }
    }
}
